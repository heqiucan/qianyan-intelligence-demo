"""Test-only server: close stdin or send stop to shut down gracefully."""
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn

server = uvicorn.Server(uvicorn.Config('backend.main:app', host='127.0.0.1', port=int(sys.argv[1]), workers=1))

def watch_parent():
    sys.stdin.readline()
    server.should_exit = True

threading.Thread(target=watch_parent, daemon=True).start()
server.run()
