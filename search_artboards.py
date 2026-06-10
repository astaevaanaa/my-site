with open("/Users/nastaastaeva/Downloads/фигма/my website/animation/icon.riv", "rb") as f:
    data = f.read()

import re
matches = re.findall(rb'[a-zA-Z0-9_\s]{2,30}', data)
for m in matches:
    try:
        s = m.decode('ascii')
        if 'art' in s.lower() or 'board' in s.lower():
            print("Found:", s)
    except:
        pass
