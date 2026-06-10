from PIL import Image

im = Image.open('screenshot_full.png')
w, h = im.size
print(f"Full image size: {w}x{h}")

# Crop into 5 vertical slices of 1200px each
for i in range(5):
    top = i * 1200
    bottom = (i + 1) * 1200
    segment = im.crop((0, top, w, bottom))
    segment.save(f'segment_{i}.png')
    print(f"Saved segment_{i}.png from y={top} to y={bottom}")
