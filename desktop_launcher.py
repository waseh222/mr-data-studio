"""Open InsightForge Studio in a native Windows Edge WebView2 desktop window.
The FastAPI processing engine remains bound to 127.0.0.1. Fallback opens a browser.
"""
from __future__ import annotations
import socket
import os
import threading
import time
import webbrowser
import uvicorn
from app import app, WORKSPACE

PORT=int(os.environ.get('INSIGHTFORGE_PORT','8765'))

def _serve():
    uvicorn.run(app,host='127.0.0.1',port=PORT,log_level='warning')

def main():
    thread=threading.Thread(target=_serve,name='InsightForgeLocalEngine',daemon=True)
    thread.start()
    for _ in range(60):
        try:
            with socket.create_connection(('127.0.0.1',PORT),timeout=.3):
                break
        except OSError:
            if not thread.is_alive():raise RuntimeError('The local analytics engine failed to start.')
            time.sleep(.15)
    else:raise RuntimeError('The local analytics engine did not start on time.')
    url=f'http://127.0.0.1:{PORT}'
    try:
        import webview
        webview.create_window('InsightForge Analytics + AI Studio v2',url,
             width=1520,height=940,min_size=(980,670),background_color='#eff4fa')
        webview.start(debug=False)
    except Exception:
        # WebView2 may not be installed; keep a functional local-browser fallback.
        webbrowser.open(url)
        thread.join()

if __name__=='__main__':main()
