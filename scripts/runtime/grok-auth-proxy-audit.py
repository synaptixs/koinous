"""Authentication-only harness: production guest plus non-secret proxy counters."""
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location('guest', '/var/mnt/koinous/integrated-guest.py')
guest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guest)
original_module = guest.egress_module


def audited_module():
    module = original_module()
    base = module.Broker

    class AuditBroker(base):
        def __init__(self, path, hosts, duration):
            self.successful_dials = 0
            self.resolved_hosts = set()
            self.reported = False
            def resolver(host):
                self.resolved_hosts.add(host)
                return module.resolve(host)
            def connector(address):
                connection = module.dial(address)
                self.successful_dials += 1
                return connection
            super().__init__(path, hosts, duration, resolver, connector)

        def close(self):
            try:
                super().close()
            finally:
                if not self.reported:
                    self.reported = True
                    print('KOINOUS_EGRESS '+json.dumps({'attempts':self.attempts,
                          'successfulDials':self.successful_dials,'tunneledBytes':self.bytes,
                          'resolvedHosts':sorted(self.resolved_hosts)}), file=sys.stderr, flush=True)

    module.Broker = AuditBroker
    return module


guest.egress_module = audited_module
sys.exit(guest.main())
