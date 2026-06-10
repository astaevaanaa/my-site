from PIL import Image

try:
    im = Image.open('artboard_Artboard_9.png')
    w, h = im.size
    print(f"Image size: {w}x{h}")
    # Convert to RGBA
    rgba = im.convert('RGBA')
    pixels = list(rgba.getdata())
    
    # Count non-transparent pixels
    non_transparent = sum(1 for p in pixels if p[3] > 0)
    print(f"Non-transparent pixels: {non_transparent} out of {w*h} ({non_transparent/(w*h)*100:.1f}%)")
    
    # Let's check bounding box of content
    bbox = im.getbbox()
    print(f"Bounding box of content: {bbox}")
    
except Exception as e:
    print(f"Error inspecting image: {e}")
