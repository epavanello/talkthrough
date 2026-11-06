#!/usr/bin/env python3
"""Runs a command in a pseudo-terminal and relays it over plain pipes.

Usage: ptybridge.py <cols> <rows> -- <command> [args...]

Claude Code's interactive interface needs a real terminal; the extension host only has pipes.
Bytes on stdin are typed into the terminal (keys, text, the dictation key), the terminal's output
comes out on stdout. `ESC ] 777 ; resize ; <cols> ; <rows> BEL` on stdin resizes the terminal
instead of being typed. Exits with the command's exit code.

SIGTERM, or stdin closing (the extension went away), hangs up the command's whole process group;
whatever is still alive a few seconds later is killed.
"""
import errno
import fcntl
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time

RESIZE = re.compile(rb"\x1b\]777;resize;(\d+);(\d+)\x07")
GRACE = 3.0


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def write_all(fd, data):
    while data:
        try:
            written = os.write(fd, data)
        except InterruptedError:
            continue
        data = data[written:]


def main():
    cols, rows = int(sys.argv[1]), int(sys.argv[2])
    command = sys.argv[4:] if sys.argv[3] == "--" else sys.argv[3:]
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execvp(command[0], command)
        except OSError as error:
            sys.stderr.write(f"ptybridge: cannot run {command[0]}: {error}\n")
            os._exit(127)
    set_size(fd, cols, rows)
    # The child leads its own session (pty.fork), so its process group is its pid
    hung_up_at = []

    def signal_group(signum):
        try:
            os.killpg(pid, signum)
        except (ProcessLookupError, PermissionError):
            pass

    def hang_up(*_):
        if not hung_up_at:
            hung_up_at.append(time.monotonic())
            signal_group(signal.SIGHUP)

    signal.signal(signal.SIGTERM, hang_up)
    stdin, stdout = sys.stdin.fileno(), sys.stdout.fileno()
    sources = [fd, stdin]
    while True:
        if hung_up_at and time.monotonic() - hung_up_at[0] > GRACE:
            signal_group(signal.SIGKILL)
        try:
            ready, _, _ = select.select(sources, [], [], 0.5)
        except InterruptedError:
            continue
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError as error:
                if error.errno == errno.EIO:  # the command closed the terminal
                    break
                raise
            if not data:
                break
            try:
                write_all(stdout, data)
            except BrokenPipeError:  # nobody reads any more: keep draining until the command is gone
                hang_up()
        if stdin in ready:
            data = os.read(stdin, 65536)
            if not data:
                # The extension went away: end the command, keep draining its output
                sources.remove(stdin)
                hang_up()
                continue
            for match in RESIZE.finditer(data):
                set_size(fd, int(match.group(1)), int(match.group(2)))
            data = RESIZE.sub(b"", data)
            if data:
                write_all(fd, data)
    _, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))


if __name__ == "__main__":
    main()
