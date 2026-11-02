import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

HELPER = Path(__file__).parents[1] / 'scripts/runtime/grok-egress.py'
spec = importlib.util.spec_from_file_location('egress', HELPER)
egress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(egress)
HEADER = b'CONNECT approved.example:443 HTTP/1.1\r\nHost: approved.example:443\r\n\r\n'


class EgressTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='ke-', dir='/tmp')
        self.path = self.directory.name+'/s'
        self.calls = []
        self.brokers = []

    def tearDown(self):
        for broker in self.brokers:
            broker.close()
        self.directory.cleanup()

    def connector(self, address):
        # Logical public IP only: never dial any external address.
        self.calls.append(address)
        left, right = socket.socketpair()
        def echo():
            try:
                right.settimeout(2)
                while True:
                    data = right.recv(65536)
                    if not data:
                        break
                    right.sendall(data)
            except OSError:
                pass
            finally:
                right.close()
        threading.Thread(target=echo, daemon=True).start()
        return left

    def broker(self, addresses=None, resolver=None, duration=3):
        broker = egress.Broker(self.path, ['approved.example'], duration,
                               resolver or (lambda host: addresses if addresses is not None else ['8.8.8.8']), self.connector)
        self.brokers.append(broker)
        return broker

    def client(self):
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(2)
        client.connect(self.path)
        self.addCleanup(client.close)
        return client

    def denied(self, client):
        try:
            self.assertEqual(client.recv(4096), b'')
        except ConnectionResetError:
            pass
        self.assertEqual(self.calls, [])

    def test_broker_thread_start_failure_removes_socket(self):
        with patch.object(egress.threading.Thread, 'start', side_effect=RuntimeError('fixture')):
            with self.assertRaises(RuntimeError): self.broker()
        self.assertFalse(Path(self.path).exists())

    def test_close_is_idempotent_and_cannot_unlink_a_new_lease(self):
        old = self.broker()
        old.close()
        self.broker()
        old.close()
        self.assertTrue(Path(self.path).exists())

    def test_success_opaque_tunnel_and_mode(self):
        self.broker()
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o600)
        client = self.client()
        client.sendall(HEADER)
        self.assertEqual(client.recv(4096), b'HTTP/1.1 200 Connection Established\r\n\r\n')
        client.sendall(b'synthetic TLS bytes')
        self.assertEqual(client.recv(4096), b'synthetic TLS bytes')
        self.assertEqual(self.calls, ['8.8.8.8'])

    def test_denied_host_never_resolves(self):
        self.broker(resolver=lambda host: self.fail('Denied host resolved'))
        client = self.client()
        client.sendall(HEADER.replace(b'approved.example', b'other.example'))
        self.denied(client)

    def test_dns_private_mixed_or_ipv6_is_denied(self):
        for addresses in [['127.0.0.1'], ['169.254.169.254'], ['10.0.0.1'], ['::1'], ['::ffff:8.8.8.8'], ['8.8.8.8', '192.168.1.1'], [], ['224.0.0.1'], ['203.0.113.1']]:
            with self.subTest(addresses=addresses):
                broker = self.broker(addresses)
                client = self.client()
                client.sendall(HEADER)
                self.denied(client)
                broker.close()

    def test_revoke_during_dns_prevents_late_dial(self):
        entered, release = threading.Event(), threading.Event()
        def resolve(host):
            entered.set()
            release.wait(2)
            return ['8.8.8.8']
        broker = self.broker(resolver=resolve)
        client = self.client()
        client.sendall(HEADER)
        self.assertTrue(entered.wait(1))
        broker.revoke()
        release.set()
        self.denied(client)
        broker.close()
        self.assertEqual(self.calls, [])

    def test_revocation_closes_established_tunnel(self):
        broker = self.broker()
        client = self.client()
        client.sendall(HEADER)
        self.assertIn(b'200', client.recv(4096))
        broker.revoke()
        self.assertEqual(client.recv(4096), b'')
        broker.close()
        self.assertFalse(Path(self.path).exists())

    def test_expired_broker_never_dials(self):
        broker = self.broker(duration=.05)
        self.assertTrue(broker.stopped.wait(1))
        self.assertEqual(broker.snapshot()['lifetime'], 1)
        self.assertEqual(self.calls, [])

    def test_attempt_and_byte_limits(self):
        broker = self.broker()
        broker.attempts = 32
        client = self.client()
        self.denied(client)
        broker.close()
        broker = self.broker()
        client = self.client()
        client.sendall(HEADER)
        self.assertIn(b'200', client.recv(4096))
        broker.bytes = 16*1024*1024
        client.sendall(b'x')
        self.assertEqual(client.recv(4096), b'')
        self.assertTrue(broker.stopped.is_set())
        self.assertEqual(broker.snapshot()['byteLimit'], 1)

    def test_headers_and_policy_reject_ambiguous_requests(self):
        hosts = egress.approved_hosts(['approved.example'])
        bad = [HEADER.replace(b':443', b':80'), HEADER.replace(b'CONNECT', b'GET'),
               HEADER.replace(b'approved.example', b'8.8.8.8'), HEADER.replace(b'approved.example', b'approved.example.evil'),
               HEADER+b'extra', HEADER.replace(b'Host:', b'Content-Length:'),
               HEADER.replace(b'Host: approved.example:443', b'Host: other.example:443'),
               HEADER.replace(b'Host:', b' Host:'), HEADER.replace(b'\r\n\r\n', b'\r\nHost: approved.example:443\r\n\r\n'),
               b'x'*4097]
        for header in bad:
            with self.subTest(header=header):
                with self.assertRaises(ValueError): egress.destination(header, hosts)
        for hosts in [['*.example'], ['127.0.0.1'], ['UPPER.example'], ['approved.example']*2, ['a.example']*17, 'approved.example']:
            with self.assertRaises(ValueError): egress.approved_hosts(hosts)

    def test_dns_failure_and_malformed_header_fail_without_dial(self):
        def fail(host): raise RuntimeError('PRIVATE_DIAGNOSTIC')
        self.broker(resolver=fail)
        client = self.client()
        client.sendall(HEADER)
        self.denied(client)
        client = self.client()
        client.sendall(b'x'*4097)
        self.denied(client)

    def test_rejection_counters_are_content_free_and_preserve_policy(self):
        broker = self.broker()
        cases = [(b'INVALID\r\n\r\n', 'host'),
                 (HEADER.replace(b'approved.example', b'secret.example'), 'host'),
                 (HEADER.replace(b'Host:', b'Secret:'), 'header')]
        for header, category in cases:
            before = broker.snapshot()[category]
            client = self.client()
            client.sendall(header)
            self.denied(client)
            self.assertEqual(broker.snapshot()[category], before+1)
        broker.attempts = 32
        self.denied(self.client())
        self.assertEqual(broker.snapshot()['attemptLimit'], 1)
        snapshot = broker.snapshot()
        snapshot['host'] = 999
        self.assertNotEqual(broker.snapshot()['host'], 999)
        self.assertEqual(set(snapshot), set(egress.COUNTERS))
        self.assertNotIn('secret', str(broker.snapshot()))
        broker.counters['io'] = egress.MAX_COUNTER
        broker.count('io')
        self.assertEqual(broker.snapshot()['io'], egress.MAX_COUNTER)

    def test_concurrency_rejection_does_not_dial(self):
        broker = self.broker()
        held = [socket.socketpair() for _ in range(8)]
        try:
            with broker.lock:
                broker.sockets.update(s for pair in held for s in pair)
            self.denied(self.client())
            self.assertEqual(broker.snapshot()['concurrencyLimit'], 1)
        finally:
            broker.close()
            for pair in held:
                for connection in pair: connection.close()

    def test_dns_and_dial_failures_have_separate_fixed_categories(self):
        def failed(_): raise RuntimeError('PRIVATE_SENTINEL')
        broker = self.broker(resolver=failed)
        client = self.client()
        client.sendall(HEADER)
        self.denied(client)
        self.assertEqual(broker.snapshot()['dns'], 1)
        broker.close()
        broker = self.broker()
        broker.connector = failed
        client = self.client()
        client.sendall(HEADER)
        self.denied(client)
        self.assertEqual(broker.snapshot()['dial'], 1)
        self.assertNotIn('PRIVATE', str(broker.snapshot()))

    def test_loopback_bridge_to_unix_broker_uses_only_injected_upstream(self):
        self.broker()
        code = """import os,socket,urllib.parse
p=urllib.parse.urlparse(os.environ['HTTPS_PROXY'])
assert p.hostname=='127.0.0.1' and os.environ['NO_PROXY']==''
assert os.environ['GROK_BUILD_ENABLE_INFERENCE']=='0'
s=socket.create_connection((p.hostname,p.port),timeout=2)
s.sendall(b'CONNECT approved.example:443 HTTP/1.1\\r\\nHost: approved.example:443\\r\\n\\r\\n')
assert b'200' in s.recv(4096)
s.sendall(b'fixture');assert s.recv(4096)==b'fixture'
s.close();print('offline bridge passed')
"""
        result = subprocess.run([sys.executable, '-B', str(HELPER), '--bridge', self.path, '--', sys.executable, '-c', code],
                                env={'PATH':os.path.dirname(sys.executable), 'GROK_BUILD_ENABLE_INFERENCE':'0'},
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'offline bridge passed')
        self.assertEqual(self.calls, ['8.8.8.8'])


if __name__ == '__main__':
    unittest.main()
