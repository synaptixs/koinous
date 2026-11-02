import importlib.util, subprocess, json, base64, os
spec=importlib.util.spec_from_file_location('guest','/var/mnt/koinous/integrated-guest.py')
guest=importlib.util.module_from_spec(spec);spec.loader.exec_module(guest)
parent_network = os.readlink('/proc/self/ns/net')
probe='''import os,json,errno,socket
from pathlib import Path
def denied(path):
 try:
  Path(path).write_text('probe');Path(path).unlink();return False
 except OSError as e:return e.errno in (errno.EROFS,errno.EACCES)
checks={'rootReadOnly':denied('/koinous-probe'),'workspaceReadOnly':denied('/tmp/workspace/probe'),'runtimeSocketsHidden':all(not Path(x).exists() for x in ['/run/podman/podman.sock','/var/run/docker.sock','/run/dbus/system_bus_socket']),'hostHomeAbsent':not Path('/Users').exists(),'guestHomeHidden':not Path('/var/home/core').exists(),'stagingHidden':not Path('/var/mnt/koinous').exists(),'otherProfilesHidden':not any(Path('/dev/shm').glob('koinous-build-*'))}
Path('/tmp/profile/probe').write_text('probe');Path('/tmp/profile/probe').unlink();checks['profileWritable']=True
checks['credentialMode600']=(Path('/tmp/profile/auth.json').stat().st_mode & 511)==384
checks['networkNamespaceIsolated']=os.readlink('/proc/self/ns/net')!=PARENT_NETWORK
checks['networkInterfacesIsolated']=all(name=='lo' for _,name in socket.if_nameindex())
print(json.dumps(checks));assert all(checks.values())
'''
def launch(args,**kwargs):
 at=args.index('/tmp/grok',args.index('--chdir')+2)
 assert args[at+args[at:].index('--sandbox')+1]=='read-only'
 args=args[:at]+['/usr/bin/python3','-c','PARENT_NETWORK='+repr(parent_network)+'\n'+probe]
 kwargs['stderr']=subprocess.PIPE
 return subprocess.Popen(args,**kwargs)
def relay(child,duration):
 out,err=child.communicate(timeout=10)
 if child.returncode:raise RuntimeError('sandbox probe failed')
 print(out.decode().strip())
guest.relay=relay
guest.run({'auth':base64.b64encode(b'{"token":"synthetic-offline-fixture"}').decode(),'timeoutMs':10000,'model':'grok-4.7'},launch)

from pathlib import Path
if any(Path('/dev/shm').glob('koinous-build-*')): raise RuntimeError('probe profile cleanup failed')
