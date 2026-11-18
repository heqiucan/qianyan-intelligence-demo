"""One active local service per database; OS locks release after process exit."""
import os
from pathlib import Path


class InstanceLease:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.file = None

    def acquire(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        stream = open(self.directory / '.runtime.lock', 'a+b')
        if stream.tell() == 0:
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            stream.close()
            raise RuntimeError('此数据目录已有运行中的 Demo。请使用单 worker，或为另一个实例设置独立 DEMO_DATA_DIR。') from None
        self.file = stream

    def release(self):
        if self.file is None:
            return
        try:
            self.file.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_UN)
        finally:
            self.file.close()
            self.file = None
