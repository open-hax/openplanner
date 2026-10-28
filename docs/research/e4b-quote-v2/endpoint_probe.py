# SPDX-License-Identifier: GPL-3.0-or-later
"""Bounded read-only Linux process/socket observations; never launches or connects.

Evidence is a preflight snapshot, not atomic ownership of a future connection.
The caller must obtain manager/lease evidence from the existing controller and
ask the CLJC law for a decision. No arbitrary endpoint becomes model-ready here.
"""
import os
import pathlib
import re


class ProbeError(RuntimeError):
    pass


def _read(path, maximum):
    with path.open('rb') as handle:
        data = handle.read(maximum + 1)
    if len(data) > maximum:
        raise ProbeError('Process metadata exceeds bound')
    return data.decode('ascii', errors='strict')


def _identity(directory, maximum):
    raw = _read(directory / 'stat', maximum)
    close = raw.rfind(')')
    if close < 0:
        raise ProbeError('Invalid process stat')
    pid = int(raw.split(' ', 1)[0])
    fields = raw[close + 2:].split()
    ticks = int(fields[19])
    rows = _read(directory / 'status', maximum).splitlines()
    uids = [row for row in rows if row.startswith('Uid:')]
    if len(uids) != 1:
        raise ProbeError('Missing unique process UID record')
    uid_values = [int(value) for value in uids[0].split()[1:]]
    if len(uid_values) != 4:
        raise ProbeError('Invalid process UID record')
    groups = _read(directory / 'cgroup', maximum).splitlines()
    unified = [row[3:] for row in groups if row.startswith('0::')]
    if len(unified) != 1:
        raise ProbeError('Unified cgroup identity required')
    return {'pid': pid, 'start-ticks': ticks, 'uids': uid_values,
            'cgroup': unified[0], 'network-namespace': os.readlink(directory / 'ns/net')}


def observe(pid, port, bounds, proc_root='/proc'):
    """Record listeners on this port and FDs of only the requested process.

    Nondefault roots are test fixtures and remain marked as such. Races,
    permission failures, missing metadata or overlarge tables fail closed.
    """
    if type(pid) is not int or pid <= 0 or type(port) is not int or not 1 <= port <= 65535:
        raise ProbeError('Invalid observation target')
    maximum = bounds['max-file-bytes']
    max_fds = bounds['max-fds']
    if type(maximum) is not int or not 0 < maximum <= 1048576:
        raise ProbeError('Invalid file bound')
    if type(max_fds) is not int or not 0 < max_fds <= 256:
        raise ProbeError('Invalid descriptor bound')
    root = pathlib.Path(proc_root)
    directory = root / str(pid)
    first = _identity(directory, maximum)
    def descriptors():
        values = []
        with os.scandir(directory / 'fd') as entries:
            for entry in entries:
                if len(values) >= max_fds:
                    raise ProbeError('Process descriptor count exceeds bound')
                values.append((entry.name, os.readlink(entry.path)))
        return sorted(values)
    first_descriptors = descriptors()
    inodes = sorted({int(m.group(1)) for _, value in first_descriptors
                     if (m := re.fullmatch(r'socket:\[(\d+)\]', value))})
    listeners = []
    for line in _read(directory / 'net/tcp', maximum).splitlines()[1:]:
        fields = line.split()
        if len(fields) < 10:
            raise ProbeError('Invalid TCP metadata row')
        address, raw_port = fields[1].split(':')
        if fields[3] == '0A' and int(raw_port, 16) == port:
            octets = bytes.fromhex(address)
            if len(octets) != 4:
                raise ProbeError('Invalid IPv4 address')
            listeners.append({'address': '.'.join(str(x) for x in reversed(octets)),
                              'port': port, 'state': 'LISTEN', 'inode': int(fields[9])})
    second = _identity(directory, maximum)
    if descriptors() != first_descriptors:
        raise ProbeError('Process descriptors changed during observation')
    if first != second or first['pid'] != pid:
        raise ProbeError('Process identity changed during observation')
    return {**first, 'source': '/proc' if str(root) == '/proc' else 'fixture',
            'stable-identity': True, 'stable-sockets': True, 'requester-uid': os.getuid(),
            'requester-network-namespace': os.readlink(root / 'self/ns/net'),
            'socket-inodes': inodes, 'listeners': listeners}


def observe_worker(worker, port, bounds):
    """Join observations to an already reconciled existing lifecycle controller.

    Reconcile does not write when the invocation was already pinned. Refuse
    an incomplete lease first; never start, stop, load or connect a worker.
    """
    if not worker.lease.invocation:
        raise ProbeError('An already pinned controller invocation is required')
    lease = {'nonce': worker.lease.nonce, 'invocation': worker.lease.invocation}

    def manager():
        state = dict(worker.reconcile())
        state['query-unit'] = worker.lease.unit
        state['MainPID'] = int(state.get('MainPID', '0'))
        return state

    before = manager()
    process = observe(before['MainPID'], port, bounds)
    after = manager()
    return {'lease': lease, 'before': before, 'after': after, 'process': process, 'port': port}
