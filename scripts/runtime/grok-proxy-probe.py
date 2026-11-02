"""Infrastructure-only Linux probe: Python replaces Grok; all upstreams synthetic."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import threading


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('probe watchdog')))
    signal.alarm(50)
    guest = load('guest', '/var/mnt/koinous/integrated-guest.py')
    egress = load('egress', '/var/mnt/koinous/egress.py')
    broker_type = egress.Broker
    brokers, paths, resolvers, dials, reports = [], [], [], [], []
    parent_namespace = os.readlink('/proc/self/ns/net')
    endpoint = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    endpoint.bind(('127.0.0.1', 0))
    endpoint.listen(4)
    endpoint.settimeout(.2)
    port = endpoint.getsockname()[1]
    stopped = threading.Event()

    def serve():
        while not stopped.is_set():
            try:
                peer, _ = endpoint.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            try:
                peer.settimeout(3)
                while True:
                    data = peer.recv(4096)
                    if not data:
                        break
                    if data == b'REVOKE':
                        brokers[-1].revoke()
                        break
                    peer.sendall(data)
            except OSError:
                pass
            finally:
                peer.close()
    thread = threading.Thread(target=serve, daemon=True)
    thread.start()

    def resolver(host):
        resolvers.append(host)
        if host == 'private.invalid':
            return ['127.0.0.1']
        if host != 'allowed.invalid':
            raise AssertionError('unapproved DNS')
        return ['8.8.8.8']  # Logical fixture address only; never resolved or dialed.

    def connector(address):
        if address != '8.8.8.8':
            raise AssertionError('invalid validated address')
        dials.append(address)
        return socket.create_connection(('127.0.0.1', port), timeout=2)

    def broker(path, hosts, duration):
        paths.append(path)
        instance = broker_type(path, hosts, duration, resolver, connector)
        brokers.append(instance)
        return instance
    egress.Broker = broker
    guest.egress_module = lambda: egress

    probe = '''import errno,json,os,socket,urllib.parse
p=urllib.parse.urlparse(os.environ['HTTPS_PROXY'])
checks={'networkNamespaceIsolated':os.readlink('/proc/self/ns/net')!=PARENT_NAMESPACE,
 'loopbackOnly':all(name=='lo' for _,name in socket.if_nameindex()),
 'inferenceDisabled':os.environ['KOINOUS_ENABLE_INFERENCE']=='0' and os.environ['GROK_BUILD_ENABLE_INFERENCE']=='0',
 'proxyLoopback':p.hostname=='127.0.0.1' and os.environ['NO_PROXY']=='',
 'noApiKey':not any('API_KEY' in k or 'AUTH_TOKEN' in k for k in os.environ)}
assert p.port!=OUTER_PORT, 'synthetic port collision; fail rather than weaken probe'
def direct(family,address):
 s=socket.socket(family,socket.SOCK_STREAM);s.settimeout(.5)
 try:return s.connect_ex(address) in (errno.ECONNREFUSED,errno.ENETUNREACH,errno.EHOSTUNREACH,errno.EADDRNOTAVAIL)
 finally:s.close()
checks['directIPv4Denied']=direct(socket.AF_INET,('127.0.0.1',OUTER_PORT))
checks['directIPv6Denied']=direct(socket.AF_INET6,('::1',OUTER_PORT))
def request(authority,unix=False):
 s=socket.socket(socket.AF_UNIX if unix else socket.AF_INET,socket.SOCK_STREAM);s.settimeout(2)
 s.connect('/tmp/egress.sock' if unix else ('127.0.0.1',p.port))
 s.sendall(('CONNECT '+authority+' HTTP/1.1\\r\\nHost: '+authority+'\\r\\n\\r\\n').encode())
 try:out=s.recv(4096)
 except ConnectionResetError:out=b''
 return s,out
for key,authority,unix in [('unapprovedHostDenied','denied.invalid:443',False),('privateDnsDenied','private.invalid:443',False),('wrongPortDenied','allowed.invalid:80',False),('ipLiteralDenied','8.8.8.8:443',False),('unixBypassDenied','denied.invalid:443',True)]:
 s,out=request(authority,unix);checks[key]=out==b'';s.close()
s,out=request('allowed.invalid:443');checks['allowedTunnel']=out==b'HTTP/1.1 200 Connection Established\\r\\n\\r\\n'
s.sendall(b'SYNTHETIC_TLS_BYTES');checks['opaqueBytesEcho']=s.recv(4096)==b'SYNTHETIC_TLS_BYTES'
s.sendall(b'REVOKE')
try:checks['activeTunnelRevoked']=s.recv(4096)==b''
except ConnectionResetError:checks['activeTunnelRevoked']=True
s.close()
print(json.dumps(checks));assert all(checks.values())
'''
    def launch(args, **kwargs):
        at = args.index('/tmp/grok', args.index('--chdir')+2)
        assert '--unshare-net' in args and '--bridge' in args
        assert args[at+args[at:].index('--sandbox')+1] == 'read-only'
        # Keep bwrap, mounts, bridge and environment exactly as production builds them.
        args = args[:at]+['/usr/bin/python3', '-B', '-c', 'PARENT_NAMESPACE='+repr(parent_namespace)+'\nOUTER_PORT='+str(port)+'\n'+probe]
        kwargs['stderr'] = subprocess.PIPE
        return subprocess.Popen(args, **kwargs)

    def relay(child, duration):
        out, err = child.communicate(timeout=15)
        if child.returncode:
            raise RuntimeError('synthetic proxy child failed: '+err.decode()[-2000:])
        report = json.loads(out)
        if not report or not all(value is True for value in report.values()):
            raise RuntimeError('synthetic checks failed')
        reports.append(report)
    guest.relay = relay
    envelope = {'auth':base64.b64encode(b'{"token":"synthetic-infrastructure-only"}').decode(),
                'timeoutMs':20000, 'model':'unused-no-model', 'networkPolicy':'restricted',
                'egressHosts':['allowed.invalid','private.invalid']}
    try:
        guest.run(envelope, launch)
        def failing_relay(child, duration):
            relay(child, duration)
            raise BrokenPipeError('synthetic transport disconnect')
        guest.relay = failing_relay
        try:
            guest.run(envelope, launch)
        except BrokenPipeError:
            pass
        else:
            raise AssertionError('failure cleanup probe did not fail')
        cleanup = {'socketRemoved':all(not Path(path).exists() for path in paths),
                   'credentialRootsRemoved':all(not Path(path).parent.exists() for path in paths),
                   'brokersRevoked':all(instance.stopped.is_set() for instance in brokers),
                   'guestProfilesAbsent':not any(Path('/dev/shm').glob('koinous-build-*'))}
        assert all(cleanup.values()) and len(reports)==2 and len(dials)==2
        assert resolvers==['private.invalid','allowed.invalid']*2
        print(json.dumps({'status':'passed','runs':reports,'cleanup':cleanup,
                          'syntheticDials':len(dials),'externalDnsRequests':0,'externalConnections':0,
                          'authenticationRequests':0,'modelRequests':0,'grokExecuted':False}))
    finally:
        for instance in brokers:
            instance.close()
        stopped.set()
        endpoint.close()
        thread.join(timeout=1)
        signal.alarm(0)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # This probe handles synthetic fixtures only; preserve bounded diagnostics.
        print(json.dumps({'status':'failed','error':str(error)[:2500], 'kind':type(error).__name__}))
