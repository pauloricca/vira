"""Generate a small deterministic RGBA POC icon in Docker; no imaging dependency."""
import struct, zlib
from pathlib import Path
def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
raw = b''.join(b'\0' + b''.join(bytes((186,244,206,255) if abs(x-(8+y//3))<2 or abs(x-(24-y//3))<2 else (17,24,33,255)) for x in range(32)) for y in range(32))
Path('icons').mkdir(exist_ok=True)
Path('icons/icon.png').write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR',struct.pack('>IIBBBBB',32,32,8,6,0,0,0)) + chunk(b'IDAT',zlib.compress(raw)) + chunk(b'IEND',b''))
