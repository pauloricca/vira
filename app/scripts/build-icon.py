"""Build the macOS icon from the V in the supplied pixel wordmark."""

from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parents[1]
BACKGROUND = (16, 25, 29, 255)  # App background, #10191d
ORANGE = (239, 162, 100, 255)  # App accent, #efa264
V_RECTS = ((0, 0, 40, 40), (40, 40, 40, 80), (80, 120, 40, 40),
           (120, 160, 40, 40), (160, 120, 40, 40),
           (200, 40, 40, 80), (240, 0, 40, 40))


def png_chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def png(size):
    # Keep the V centred with a generous margin, even at Dock icon sizes.
    scale = size * 0.72 / 280
    left = (size - 280 * scale) / 2
    top = (size - 200 * scale) / 2
    rows = []
    for y in range(size):
        row = bytearray(b'\0')
        for x in range(size):
            vx = (x + 0.5 - left) / scale
            vy = (y + 0.5 - top) / scale
            colour = ORANGE if any(rx <= vx < rx + rw and ry <= vy < ry + rh
                                   for rx, ry, rw, rh in V_RECTS) else BACKGROUND
            row.extend(colour)
        rows.append(row)
    data = b''.join(rows)
    return (b'\x89PNG\r\n\x1a\n'
            + png_chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + png_chunk(b'IDAT', zlib.compress(data, 9))
            + png_chunk(b'IEND', b''))


def main():
    sizes = ((16, b'icp4'), (32, b'icp5'), (64, b'icp6'),
             (128, b'ic07'), (256, b'ic08'), (512, b'ic09'), (1024, b'ic10'))
    chunks = []
    for size, code in sizes:
        image = png(size)
        chunks.append(code + struct.pack('>I', len(image) + 8) + image)
        if size == 32:
            (ROOT / 'src-tauri/icons/icon.png').write_bytes(image)
    body = b''.join(chunks)
    destination = ROOT / 'output/VIRA.app/Contents/Resources/VIRA.icns'
    destination.write_bytes(b'icns' + struct.pack('>I', len(body) + 8) + body)


if __name__ == '__main__':
    main()
