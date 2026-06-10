import http.server
import socketserver
import urllib.parse
import sys
import base64
import subprocess
import time
from PIL import Image

class LogHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        data = urllib.parse.parse_qs(post_data.decode('utf-8'))
        name = data.get('name', ['unknown'])[0]
        img_data = data.get('image', [''])[0]
        
        if img_data.startswith('data:image/png;base64,'):
            header, encoded = img_data.split(",", 1)
            binary_data = base64.b64decode(encoded)
            filename = f"artboard_{name.replace(' ', '_')}.png"
            with open(filename, "wb") as fh:
                fh.write(binary_data)
            print(f"Saved {filename}", flush=True)
            
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"OK")

def inspect(filename):
    try:
        im = Image.open(filename)
        w, h = im.size
        rgba = im.convert('RGBA')
        pixels = list(rgba.get_flattened_data() if hasattr(rgba, 'get_flattened_data') else rgba.getdata())
        # For standard getdata, pixels is list of tuples. For flattened, it's list of ints.
        if isinstance(pixels[0], int):
            non_transparent = sum(1 for i in range(3, len(pixels), 4) if pixels[i] > 0)
        else:
            non_transparent = sum(1 for p in pixels if p[3] > 0)
        bbox = im.getbbox()
        print(f"{filename}: size {w}x{h}, non-transparent: {non_transparent} ({non_transparent/(w*h)*100:.1f}%), bbox: {bbox}")
    except Exception as e:
        print(f"Error inspecting {filename}: {e}")

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    
    # We will launch the server in a separate thread/process or just run handle_request.
    # Since we want to handle a single request, we can just run handle_request() after launching chrome.
    # But Chrome runs asynchronously, so let's start the server first, start chrome, and wait for Chrome to call us.
    
    with socketserver.TCPServer(("", 8089), LogHandler) as httpd:
        print("Server started on 8089. Launching Chrome...", flush=True)
        # Run chrome in the background
        chrome_cmd = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "--headless",
            "--disable-gpu",
            "http://localhost:8000/test.html"
        ]
        subprocess.Popen(chrome_cmd)
        
        # Handle 1 request (for Artboard 7)
        httpd.handle_request()

    print("\nInspection results:")
    inspect("artboard_Artboard_9.png")
    inspect("artboard_Artboard_7.png")
