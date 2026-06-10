import http.server
import socketserver
import urllib.parse
import sys
import base64

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
            print(f"SAVED_IMAGE: {filename}", flush=True)
            
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"OK")

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", 8088), LogHandler) as httpd:
        print("Server started on 8088", flush=True)
        # Handle 2 requests (Artboard 9 and Artboard 7)
        for _ in range(2):
            httpd.handle_request()
