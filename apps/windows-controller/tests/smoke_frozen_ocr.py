"""Exercise packaged native OCR child with synthetic pixels only."""
import io
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

canvas=Image.new("RGB",(610,260),(24,24,24))
paint=ImageDraw.Draw(canvas)
font=ImageFont.truetype("C:/Windows/Fonts/arial.ttf",36)
paint.text((30,85),"Unread 8",fill="white",font=font)
buffer=io.BytesIO()
canvas.save(buffer,format="PNG")
exe=Path(__file__).resolve().parents[1]/"dist"/"hukm-controller.exe"
r=subprocess.run([str(exe),"--local-ocr-worker"],input=buffer.getvalue(),
    capture_output=True,timeout=60,check=True)
words=json.loads(r.stdout)
assert any("unread" in w["text"].casefold() for w in words), "Native OCR phrase missing"
print("Packaged local OCR worker passed on synthetic image")
