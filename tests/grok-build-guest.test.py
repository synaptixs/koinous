import base64
import hashlib
import importlib.util
import os
import shutil
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('guest', Path(__file__).parents[1] / 'scripts/runtime/grok-build-guest.py')
guest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guest)
egress_spec = importlib.util.spec_from_file_location('egress_fixture', Path(__file__).parents[1] / 'scripts/runtime/grok-egress.py')
egress = importlib.util.module_from_spec(egress_spec)
egress_spec.loader.exec_module(egress)


class GuestTests(unittest.TestCase):
    def exercise(self, failure=None, launch_failure=False, wait_failure=False, kill_failure=False, delete_failure=False, restricted=False):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'grok'
            binary.write_bytes(b'offline fixture, never executed')
            original_mkdtemp = tempfile.mkdtemp
            original_exists = Path.exists
            roots = []
            launches = []
            timeline = []
            broker = Mock()
            broker.snapshot.return_value = dict.fromkeys(egress.COUNTERS, 0)
            broker.revoke.side_effect = lambda: timeline.append('revoke')
            broker.close.side_effect = lambda: timeline.append('close')
            child = Mock(pid=12345)
            def wait(**kwargs):
                timeline.append('reap')
                if wait_failure: raise RuntimeError('wait failed')
            child.wait.side_effect = wait
            def temporary(**kwargs):
                root = original_mkdtemp(prefix=kwargs['prefix'], dir=directory)
                roots.append(Path(root).resolve())
                return root
            def launch(args, **kwargs):
                launches.append((args, kwargs))
                credential = roots[0] / 'profile/auth.json'
                self.assertEqual(credential.read_text(), '{"token":"fixture"}')
                self.assertEqual(credential.stat().st_mode & 0o777, 0o600)
                self.assertEqual(roots[0].stat().st_mode & 0o777, 0o700)
                if launch_failure:
                    raise RuntimeError('spawn failed')
                return child
            with patch.object(guest, 'egress_module', return_value=egress), patch.object(egress, 'Broker', return_value=broker) as create_broker, patch.object(guest, 'BINARY', str(binary)), patch.object(guest, 'SHA256', hashlib.sha256(binary.read_bytes()).hexdigest()), patch.object(guest.os, 'getuid', return_value=501), patch.object(guest.subprocess, 'check_output', return_value=b'{"filesystems":[{"target":"/var/mnt/koinous","options":"ro,relatime"}]}'), patch.object(Path, 'exists', lambda p: False if str(p) == '/Users' else original_exists(p)), patch.object(guest.tempfile, 'mkdtemp', temporary), patch.object(guest, 'relay', side_effect=failure), patch.object(guest.os, 'killpg', side_effect=RuntimeError('kill failed') if kill_failure else None) as kill, patch.object(guest.shutil, 'rmtree', side_effect=RuntimeError('delete failed') if delete_failure else shutil.rmtree):
                envelope = {'auth': base64.b64encode(b'{"token":"fixture"}').decode(), 'model': 'grok-4.7', 'timeoutMs': 30000}
                if restricted:
                    envelope.update(networkPolicy='restricted', egressHosts=['approved.example'])
                if failure or launch_failure or wait_failure or kill_failure or delete_failure:
                    with self.assertRaises(Exception):
                        guest.run(envelope, launch)
                else:
                    guest.run(envelope, launch)
                self.assertTrue(roots)
                self.assertEqual(roots[0].exists(), wait_failure or kill_failure or delete_failure, 'unconfirmed process reap must retain evidence; otherwise remove credentials')
                if not launch_failure:
                    kill.assert_called_once()
                if restricted:
                    create_broker.assert_called_once_with(str(roots[0] / 'egress.sock'), ['approved.example'], 30)
                    self.assertEqual(timeline[0], 'revoke')
                    self.assertEqual(timeline[-1], 'close')
                else:
                    create_broker.assert_not_called()
                args, options = launches[0]
                if restricted:
                    socket_at = args.index(str(roots[0] / 'egress.sock'))
                    self.assertEqual(args[socket_at-1:socket_at+2], ['--ro-bind', str(roots[0] / 'egress.sock'), '/tmp/egress.sock'])
                    self.assertIn('--bridge', args)
                    self.assertEqual(args[args.index('--bridge')+1], '/tmp/egress.sock')
                self.assertEqual(options['stderr'], guest.subprocess.DEVNULL)
                self.assertEqual(args[0], '/usr/bin/bwrap')
                self.assertIn('--unshare-user', args)
                self.assertIn('--unshare-net', args)
                self.assertNotIn('--share-net', args)
                self.assertEqual(options['env']['GROK_BUILD_ENABLE_INFERENCE'], '0')
                self.assertEqual(options['env']['KOINOUS_ENABLE_INFERENCE'], '0')
                self.assertIn('--die-with-parent', args)
                self.assertEqual(args[args.index('--sandbox')+1], 'read-only')
                self.assertEqual(args[args.index('--permission-mode')+1], 'dontAsk')
                self.assertEqual(args[args.index('--tools')+1], '')
                self.assertNotIn('XAI_API_KEY', options['env'])
                self.assertIn('--ro-bind', args)
                workspace_at = args.index(str(roots[0] / 'workspace'))
                self.assertEqual(args[workspace_at-1:workspace_at+2], ['--ro-bind', str(roots[0] / 'workspace'), '/tmp/workspace'])
                self.assertNotIn('--privileged', args)

    def test_unexpected_shares_rejected_before_profile_creation(self):
        with patch.object(guest.os, 'getuid', return_value=501), patch.object(Path, 'exists', return_value=False), patch.object(guest.subprocess, 'check_output', return_value=b'{"filesystems":[{"target":"/host-home","options":"rw"}]}'), patch.object(guest.tempfile, 'mkdtemp') as create:
            with self.assertRaises(RuntimeError): guest.run({})
            create.assert_not_called()

    def test_binary_mismatch_rejected_before_profile_creation(self):
        with patch.object(guest.os, 'getuid', return_value=501), patch.object(Path, 'exists', return_value=False), patch.object(Path, 'read_bytes', return_value=b'wrong binary'), patch.object(guest.subprocess, 'check_output', return_value=b'{"filesystems":[{"target":"/var/mnt/koinous","options":"ro"}]}'), patch.object(guest.tempfile, 'mkdtemp') as create:
            with self.assertRaises(RuntimeError): guest.run({})
            create.assert_not_called()

    def test_network_policy_cannot_enable_shared_network(self):
        for policy in ['host', 'allow-all', 'proxy', None, {}]:
            with patch.object(guest.tempfile, 'mkdtemp') as create:
                with self.assertRaises(RuntimeError): guest.run({'networkPolicy': policy})
                create.assert_not_called()

    def test_diagnostic_write_is_nonblocking_and_backpressure_is_harmless(self):
        broker = Mock()
        broker.snapshot.return_value = dict.fromkeys(egress.COUNTERS, 0)
        for failure in [None, BlockingIOError(), BrokenPipeError()]:
            with patch.object(guest.os, 'get_blocking', return_value=True), patch.object(guest.os, 'set_blocking') as mode, patch.object(guest.os, 'write', side_effect=failure) as write:
                guest.emit_proxy(broker)
                self.assertEqual(mode.call_args_list[0].args, (2, False))
                self.assertEqual(mode.call_args_list[-1].args, (2, True))
                frame = write.call_args.args[1]
                self.assertLess(len(frame), 1024)
                self.assertTrue(frame.startswith(b'KOINOUS_GROK_PROXY_V1 '))

    def test_relay_rate_limits_snapshots_without_external_io(self):
        clock = [0.0]
        selector = Mock()
        selector.__enter__ = Mock(return_value=selector)
        selector.__exit__ = Mock(return_value=False)
        def tick(_):
            clock[0] += .25
            return []
        selector.select.side_effect = tick
        with patch.object(guest.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(guest.selectors, 'DefaultSelector', return_value=selector), patch.object(guest, 'emit_proxy') as emit:
            with self.assertRaisesRegex(RuntimeError, 'deadline'):
                guest.relay(Mock(), 120, Mock())
            self.assertEqual(emit.call_count, 120)

    def test_restricted_success_cleanup(self): self.exercise(restricted=True)
    def test_restricted_spawn_failure(self): self.exercise(restricted=True, launch_failure=True)
    def test_restricted_reap_failure_revokes_broker(self): self.exercise(restricted=True, wait_failure=True)
    def test_restricted_protocol_failure(self): self.exercise(restricted=True, failure=ValueError())

    def test_invalid_allowlist_fails_before_staging(self):
        for hosts in [[], ['*.example'], ['127.0.0.1'], 'approved.example']:
            with patch.object(guest, 'egress_module', return_value=egress), patch.object(guest.tempfile, 'mkdtemp') as create:
                with self.assertRaises((ValueError, RuntimeError)):
                    guest.run({'networkPolicy':'restricted', 'egressHosts':hosts})
                create.assert_not_called()

    def test_success_cleanup(self): self.exercise()
    def test_spawn_failure_cleanup(self): self.exercise(launch_failure=True)
    def test_deadline_cleanup(self): self.exercise(TimeoutError())
    def test_disconnect_cleanup(self): self.exercise(BrokenPipeError())
    def test_protocol_failure_cleanup(self): self.exercise(ValueError())
    def test_wait_failure_cleanup(self): self.exercise(wait_failure=True)
    def test_kill_failure_retains_evidence(self): self.exercise(kill_failure=True)
    def test_delete_failure_is_reported(self): self.exercise(delete_failure=True)

if __name__ == '__main__':
    unittest.main()
