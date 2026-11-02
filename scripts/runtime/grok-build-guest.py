"""Bounded ACP bridge for an explicitly provisioned, dedicated Linux VM.
Credentials arrive only on stdin. Never print exception values or child stderr.
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import selectors
import shutil
import signal
import subprocess
import sys
import tempfile
import time

SHA256 = '3aa36883574b263088e5addffe241f55430e8daaee1a0c4934b02180007a9761'
BINARY = '/var/mnt/koinous/grok'
EGRESS_HELPER = '/var/mnt/koinous/egress.py'

def egress_module():
    spec = importlib.util.spec_from_file_location('koinous_egress', EGRESS_HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

CONFIG = '[cli]\nauto_update = false\n[models]\nmax_retries = 0\nmax_completion_tokens = 1200\n[features]\ncodebase_indexing = false\n[session]\nload_envrc = false\n'


def read_envelope():
    data = bytearray()
    while len(data) <= 262144:
        part = os.read(0, 1)
        if part == b'\n':
            return json.loads(data)
        if not part:
            raise RuntimeError('missing envelope')
        data.extend(part)
    raise RuntimeError('envelope limit')


def run(envelope, launch=subprocess.Popen):
    policy = envelope.get('networkPolicy', 'deny-all')
    if policy not in ('deny-all', 'restricted'):
        raise RuntimeError('unsupported guest network policy')
    hosts = envelope.get('egressHosts', [])
    egress = egress_module() if policy == 'restricted' else None
    if egress:
        if not egress.approved_hosts(hosts):
            raise RuntimeError('restricted policy needs explicit hosts')
    elif hosts != []:
        raise RuntimeError('deny-all does not accept hosts')
    # Canonical paths avoid Build's symlink validation failure.
    if os.getuid() == 0 or Path('/Users').exists():
        raise RuntimeError('dedicated nonroot VM required')
    shares = json.loads(subprocess.check_output(
        ['/usr/bin/findmnt', '--json', '--types', 'virtiofs', '--output', 'TARGET,OPTIONS'],
        timeout=5))['filesystems']
    if len(shares) != 1 or shares[0]['target'] != '/var/mnt/koinous' or 'ro' not in shares[0]['options'].split(','):
        raise RuntimeError('unexpected host share')
    if hashlib.sha256(Path(BINARY).read_bytes()).hexdigest() != SHA256:
        raise RuntimeError('binary mismatch')
    duration = envelope['timeoutMs'] / 1000
    if not 0 < duration <= 120:
        raise RuntimeError('invalid timeout')
    auth = base64.b64decode(envelope['auth'], validate=True)
    json.loads(auth)
    root = Path(tempfile.mkdtemp(prefix='koinous-build-', dir='/dev/shm')).resolve()
    child = None
    broker = None
    try:
        profile = root / 'profile'
        profile.mkdir(mode=0o700)
        workspace = root / 'workspace'
        workspace.mkdir(mode=0o700)
        credential = profile / 'auth.json'
        credential.write_bytes(auth)
        credential.chmod(0o600)
        del auth
        (profile / 'config.toml').write_text(CONFIG)
        env = {'PATH': '/usr/bin:/bin', 'HOME': '/tmp', 'GROK_HOME': '/tmp/profile',
               'GROK_DISABLE_AUTOUPDATER': '1', 'KOINOUS_ENABLE_INFERENCE': '0',
               'GROK_BUILD_ENABLE_INFERENCE': '0'}
        for feature in ['MEMORY', 'SUBAGENTS', 'GOAL', 'WRITE_FILE', 'WEB_FETCH', 'LSP_TOOLS', 'TELEMETRY_ENABLED', 'FEEDBACK_ENABLED']:
            env['GROK_' + feature] = '0'
        for source in ['CURSOR', 'CLAUDE']:
            for kind in ['SKILLS', 'RULES', 'AGENTS', 'MCPS', 'HOOKS']:
                env[f'GROK_{source}_{kind}_ENABLED'] = '0'
        # Mask sockets, shares and other guest profiles; expose only this invocation's profile.
        args = ['/usr/bin/bwrap', '--unshare-net', '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts',
                '--die-with-parent', '--new-session', '--ro-bind', '/', '/', '--tmpfs', '/run',
                '--tmpfs', '/tmp', '--tmpfs', '/var/home', '--tmpfs', '/var/mnt',
                '--tmpfs', '/dev/shm', '--proc', '/proc', '--dev', '/dev',
                '--ro-bind', BINARY, '/tmp/grok', '--bind', str(profile), '/tmp/profile',
                '--ro-bind', str(workspace), '/tmp/workspace', '--chdir', '/tmp/workspace',
                '/tmp/grok', '--tools', '', '--deny', '*', '--permission-mode', 'dontAsk',
                '--sandbox', 'read-only', '--max-turns', '1', '--no-plan', '--no-subagents',
                '--disable-web-search', 'agent', '--no-leader', '--model', envelope['model'],
                '--reasoning-effort', 'low', 'stdio']
        if egress:
            # Only this invocation's socket is mounted. The namespace still has
            # no outbound IP route; bypassing the bridge cannot bypass the broker.
            socket_path = str(root / 'egress.sock')
            broker = egress.Broker(socket_path, hosts, duration)
            command_at = args.index('/tmp/grok', args.index('--chdir')+2)
            args = args[:command_at] + ['--ro-bind', socket_path, '/tmp/egress.sock',
                    '--ro-bind', EGRESS_HELPER, '/tmp/egress.py',
                    '/usr/bin/python3', '-B', '/tmp/egress.py', '--bridge', '/tmp/egress.sock', '--'] + args[command_at:]
        child = launch(args, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                       stderr=subprocess.DEVNULL, start_new_session=True)
        relay(child, duration, broker)
    finally:
        if broker is not None:
            broker.revoke()
        try:
            if child is not None:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                # Unconfirmed reap preserves credentials for managed VM destruction.
                child.wait(timeout=5)
        finally:
            if broker is not None:
                broker.close()
                emit_proxy(broker)
        shutil.rmtree(root)


def emit_proxy(broker):
    # Trusted wrapper only: child stderr remains discarded. Fixed counters only.
    if broker is not None:
        try:
            frame = ('KOINOUS_GROK_PROXY_V1 '+json.dumps(broker.snapshot(), separators=(',', ':'))+'\n').encode('ascii')
            if len(frame) > 1024:
                return
            blocking = os.get_blocking(2)
            try:
                os.set_blocking(2, False)
                os.write(2, frame)
            finally:
                os.set_blocking(2, blocking)
        except (OSError, ValueError, TypeError):
            pass  # Diagnostics must not interfere with credential cleanup.


def relay(child, duration, broker=None):
    # EOF on the SSH channel, output limit, or deadline always reaches credential cleanup.
    deadline = time.monotonic() + duration
    total = 0
    next_snapshot = 0
    snapshots = 0
    with selectors.DefaultSelector() as selector:
        selector.register(0, selectors.EVENT_READ, 'input')
        selector.register(child.stdout, selectors.EVENT_READ, 'output')
        while time.monotonic() < deadline:
            now = time.monotonic()
            if broker is not None and now >= next_snapshot and snapshots < 120:
                emit_proxy(broker)
                snapshots += 1
                next_snapshot = now+1
            for key, _ in selector.select(min(.25, max(0, deadline - time.monotonic()))):
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    return
                total += len(chunk)
                if total > 4 * 1024 * 1024:
                    raise RuntimeError('transport limit')
                if key.data == 'input':
                    child.stdin.write(chunk)
                    child.stdin.flush()
                else:
                    sys.stdout.buffer.write(chunk)
                    sys.stdout.buffer.flush()
        raise RuntimeError('deadline')


def main():
    # Bound even envelope receipt/setup and a disconnected or blocked SSH transport.
    def expired(_signum, _frame):
        raise RuntimeError('watchdog')
    signal.signal(signal.SIGALRM, expired)
    signal.signal(signal.SIGTERM, expired)
    signal.signal(signal.SIGHUP, expired)
    signal.alarm(130)
    try:
        run(read_envelope())
    except Exception:
        print('Grok isolated runtime failed; cleanup not confirmed', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
