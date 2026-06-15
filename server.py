import http.server
import json

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_POST(self):
        if self.path == '/save-config':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                payload = json.loads(post_data.decode('utf-8'))
                config_data = payload.get('config', {})
                css_data = payload.get('css', '')

                # Write editor-config.json
                with open('editor-config.json', 'w', encoding='utf-8') as f:
                    json.dump(config_data, f, indent=2, ensure_ascii=False)

                # Write editor-overrides.css
                with open('editor-overrides.css', 'w', encoding='utf-8') as f:
                    f.write(css_data)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"status":"success"}')
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                err_msg = json.dumps({"status": "error", "message": str(e)})
                self.wfile.write(err_msg.encode('utf-8'))
            return
        
        self.send_response(404)
        self.end_headers()

if __name__ == '__main__':
    http.server.test(HandlerClass=NoCacheHTTPRequestHandler, port=8000)
