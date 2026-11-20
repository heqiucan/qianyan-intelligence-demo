"""Bounded Windows file synthesis; never send text to a network TTS service."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import threading
import wave
from fastapi import HTTPException


class SapiProvider:
    key = 'windows-system-speech-v1'

    def __init__(self, directory):
        self.directory = Path(directory) / 'speech-audio'
        self.lock = threading.Lock()
        self._voices = None

    def _run(self, body, timeout=45):
        if os.name != 'nt':
            raise HTTPException(503, '当前服务器不是 Windows，系统语音不可用。话术管理仍可使用。')
        executable = shutil.which('pwsh') or str(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe')
        try:
            command = base64.b64encode(Path(__file__).with_name('sapi.ps1').read_text(encoding='utf-8-sig').encode('utf-16-le')).decode('ascii')
            result = subprocess.run([str(executable), '-NoProfile', '-NonInteractive', '-EncodedCommand', command],
                                    input=json.dumps(body, ensure_ascii=False), capture_output=True, encoding='utf-8', errors='replace',
                                    timeout=timeout, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if result.returncode:
                raise HTTPException(503, 'Windows 系统语音合成失败，请检查已安装音色或重试。')
            return json.loads(result.stdout.lstrip('\ufeff'))
        except subprocess.TimeoutExpired:
            raise HTTPException(504, '语音合成超时，已停止本次合成。请缩短文本后重试。')
        except (OSError, ValueError):
            raise HTTPException(503, '无法读取 Windows 系统语音，请检查系统语音组件。')

    def voices(self):
        if self._voices is None:
            self._voices = self._run({'action': 'voices'}, 15)
        return self._voices

    def synthesize(self, text, voice, rate=0, volume=100):
        if voice not in {v['id'] for v in self.voices()}:
            raise HTTPException(422, '所选音色在当前服务器不可用，请重新选择。')
        digest = hashlib.sha256(json.dumps([self.key, voice, rate, volume, text], ensure_ascii=False).encode()).hexdigest()
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / (digest + '.wav')
        if not self.lock.acquire(blocking=False):
            raise HTTPException(429, '已有语音正在合成，请稍后重试。')
        try:
            cached = path.is_file()
            if not cached:
                # Bounded cache for anonymous demo and long-running local use.
                if sum(p.stat().st_size for p in self.directory.glob('*.wav')) > 1024 * 1024 * 1024:
                    raise HTTPException(507, '语音缓存达到 1 GB，请联系管理员清理后再合成。')
                temporary = self.directory / (digest + '.pending.wav')
                try:
                    self._run(dict(action='synthesize', text=text, voice=voice, rate=rate, volume=volume, output=str(temporary)))
                    with wave.open(str(temporary), 'rb') as audio:
                        if audio.getnframes() <= 0:
                            raise HTTPException(503, '系统语音未生成有效音频，请更换文本或音色。')
                    temporary.replace(path)
                finally:
                    temporary.unlink(missing_ok=True)
            with wave.open(str(path), 'rb') as audio:
                duration = audio.getnframes() / audio.getframerate()
            return dict(id=digest, duration=duration, cached=cached, url='/api/live/speech/audio/' + digest)
        finally:
            self.lock.release()
