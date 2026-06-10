const { exec } = require('child_process');
const fs = require('fs');
const http = require('http');

const chromeProcess = exec('"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --remote-debugging-port=9222 http://localhost:8000/inspect_icon_artboards.html');

setTimeout(() => {
  http.get('http://127.0.0.1:9222/json/list', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const pages = JSON.parse(data);
        let page = pages.find(p => p.url.includes('inspect_icon_artboards.html'));
        if (!page) page = pages[0];
        
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        
        ws.onopen = () => {
          ws.send(JSON.stringify({ id: 1, method: 'Console.enable' }));
        };
        
        ws.onmessage = (event) => {
          const response = JSON.parse(event.data);
          if (response.method === 'Console.messageAdded') {
            const text = response.params.message.text;
            console.log(text);
            if (text.startsWith("ARTBOARD_NAMES:")) {
              ws.close();
              chromeProcess.kill();
              process.exit(0);
            }
          }
        };
      } catch (e) {
        console.error(e);
        chromeProcess.kill();
        process.exit(1);
      }
    });
  });
}, 2000);
