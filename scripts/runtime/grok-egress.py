"""Private Unix-socket HTTPS CONNECT broker and in-namespace loopback bridge.
No TLS interception, credentials, provider defaults, logging or network fallback.
"""
import ipaddress
import os
import re
import select
import socket
import subprocess
import sys
import threading
import time


def approved_hosts(hosts):
    if not isinstance(hosts, list) or len(hosts) > 16:
        raise ValueError('invalid hosts')
    for host in hosts:
        if not isinstance(host, str) or len(host) > 253 or not re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]', host):
            raise ValueError('invalid host')
    if len(set(hosts)) != len(hosts):
        raise ValueError('duplicate host')
    return frozenset(hosts)


def destination(header, hosts):
    # One canonical CONNECT request, no body, pipelined bytes or ambiguous fields.
    if len(header) > 4096 or not header.endswith(b'\r\n\r\n'):
        raise ValueError('invalid header')
    lines = header.decode('ascii').split('\r\n')
    match = re.fullmatch(r'CONNECT ([a-z0-9.-]+):443 HTTP/1\.[01]', lines[0])
    if not match or match[1] not in hosts:
        raise ValueError('destination denied')
    seen = set()
    for line in lines[1:-2]:
        if ':' not in line or line.startswith((' ', '\t')):
            raise ValueError('invalid field')
        key, value = line.split(':', 1)
        key = key.lower()
        if key in seen or key not in ('host', 'user-agent', 'proxy-connection', 'connection'):
            raise ValueError('unsupported field')
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('invalid field')
        if key == 'host' and value.strip() != match[1]+':443':
            raise ValueError('authority mismatch')
        seen.add(key)
    return match[1]


def public_addresses(addresses):
    if not addresses or len(addresses) > 32:
        raise ValueError('invalid DNS result')
    for address in addresses:
        parsed = ipaddress.ip_address(address)
        if parsed.version != 4 or not parsed.is_global or parsed.is_multicast:
            raise ValueError('non-public address')
    return addresses


def resolve(host):
    return list(dict.fromkeys(row[4][0] for row in socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)))


def dial(address):
    # Numeric address already validated; never re-resolve the hostname at connect.
    connection = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        connection.settimeout(5)
        connection.connect((address, 443))
        return connection
    except BaseException:
        connection.close()
        raise


COUNTERS = ('accepted', 'attemptLimit', 'concurrencyLimit', 'header', 'host',
            'dns', 'dial', 'lifetime', 'byteLimit', 'io', 'tunnels')
MAX_COUNTER = 2147483647


class Broker:
    def __init__(self, path, hosts, duration, resolver=resolve, connector=dial):
        self.hosts = approved_hosts(hosts)
        if not 0 < duration <= 120:
            raise ValueError('invalid lifetime')
        self.path, self.resolver, self.connector = path, resolver, connector
        self.deadline = time.monotonic()+duration
        self.lock = threading.RLock()
        self.stopped = threading.Event()
        self.closed = False
        self.sockets = set()
        self.attempts = self.bytes = 0
        self.counters = dict.fromkeys(COUNTERS, 0)
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            self.listener.bind(path)
            os.chmod(path, 0o600)
            self.listener.listen(16)
            self.listener.settimeout(.1)
        except BaseException:
            self.listener.close()
            raise
        self.thread = threading.Thread(target=self.accept, daemon=True)
        try:
            self.thread.start()
        except BaseException:
            self.listener.close()
            os.unlink(self.path)
            raise

    def count(self, category):
        with self.lock:
            self.counters[category] = min(MAX_COUNTER, self.counters[category]+1)

    def snapshot(self):
        with self.lock:
            return dict(self.counters)

    def alive(self):
        return not self.stopped.is_set() and time.monotonic() < self.deadline

    def accept(self):
        while self.alive():
            try:
                client, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            with self.lock:
                self.attempts = min(MAX_COUNTER, self.attempts+1)
                self.count('accepted')
                reason = 'lifetime' if not self.alive() else 'attemptLimit' if self.attempts > 32 else 'concurrencyLimit' if len(self.sockets) >= 16 else None
                if reason:
                    self.count(reason)
                    client.close()
                    continue
                self.sockets.add(client)
            threading.Thread(target=self.handle, args=(client,), daemon=True).start()
        if not self.stopped.is_set():
            self.count('lifetime')
        self.revoke()

    def handle(self, client):
        upstream = None
        category = 'header'
        try:
            client.settimeout(2)
            header = bytearray()
            end = min(self.deadline, time.monotonic()+5)
            while b'\r\n\r\n' not in header:
                if time.monotonic() >= end or not self.alive():
                    raise ValueError('header deadline')
                chunk = client.recv(4097-len(header))
                if not chunk or len(header)+len(chunk) > 4096:
                    raise ValueError('header limit')
                header.extend(chunk)
            try:
                host = destination(bytes(header), self.hosts)
            except ValueError as error:
                if str(error) == 'destination denied':
                    category = 'host'
                raise
            category = 'dns'
            addresses = public_addresses(self.resolver(host))
            # Revocation/DNS races cannot initiate a new dial after revocation.
            with self.lock:
                if not self.alive():
                    return
                category = 'dial'
                upstream = self.connector(addresses[0])
                if not self.alive():
                    upstream.close()
                    return
                self.sockets.add(upstream)
            category = 'io'
            self.count('tunnels')
            client.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            self.pump(client, upstream)
        except Exception:
            # Never echo exception text, requests, TLS bytes or credentials.
            if self.alive():
                self.count(category)
        finally:
            with self.lock:
                for connection in (client, upstream):
                    if connection is not None:
                        self.sockets.discard(connection)
                        connection.close()

    def pump(self, left, right):
        left.settimeout(1)
        right.settimeout(1)
        while self.alive():
            readable, _, _ = select.select([left, right], [], [], .1)
            for source in readable:
                data = source.recv(65536)
                if not data:
                    return
                with self.lock:
                    self.bytes += len(data)
                    if self.bytes > 16*1024*1024:
                        self.count('byteLimit')
                        self.revoke()
                        return
                (right if source is left else left).sendall(data)

    def revoke(self):
        self.stopped.set()
        with self.lock:
            for connection in tuple(self.sockets):
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                connection.close()
            self.sockets.clear()

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
        self.revoke()
        self.listener.close()
        self.thread.join(timeout=1)
        # Namespace/worker must be reaped before its socket capability is removed.
        try:
            os.unlink(self.path)
        except FileNotFoundError:
            pass


def bridge(path, command):
    # Runs inside --unshare-net; loopback is its only IP interface. The broker
    # outside the namespace validates even callers that bypass this bridge.
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(('127.0.0.1', 0))
    listener.listen(16)
    listener.settimeout(.1)
    stopped = threading.Event()
    slots = threading.BoundedSemaphore(8)

    def forward(client):
        peer = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            peer.settimeout(2)
            peer.connect(path)
            client.settimeout(2)
            while not stopped.is_set():
                readable, _, _ = select.select([client, peer], [], [], .1)
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    (peer if source is client else client).sendall(data)
        except Exception:
            pass
        finally:
            peer.close()
            client.close()
            slots.release()

    def accept():
        while not stopped.is_set():
            try:
                client, _ = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            if not slots.acquire(blocking=False):
                client.close()
                continue
            threading.Thread(target=forward, args=(client,), daemon=True).start()

    thread = threading.Thread(target=accept, daemon=True)
    thread.start()
    proxy = 'http://127.0.0.1:'+str(listener.getsockname()[1])
    env = dict(os.environ)
    for key in ('HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'):
        env[key] = proxy
    env['NO_PROXY'] = env['no_proxy'] = ''
    try:
        return subprocess.call(command, env=env)
    finally:
        stopped.set()
        listener.close()
        thread.join(timeout=1)


if __name__ == '__main__':
    if len(sys.argv) < 5 or sys.argv[1] != '--bridge' or sys.argv[3] != '--':
        sys.exit(2)
    sys.exit(bridge(sys.argv[2], sys.argv[4:]))
