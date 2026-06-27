import io, zipfile
from pathlib import Path
from fontTools.ttLib import TTFont

OUT = Path(__file__).resolve().parents[1] / 'assets' / 'fonts'
CPS = [0x16A6, 0xF8D0, 0x16D06, 0x16D84, 0xE006, 0xE080]

def cmap(path, cps):
    f = TTFont(path)
    cm = f.getBestCmap() or {}
    return {hex(cp): cp in cm for cp in cps}

for name in sorted(OUT.iterdir()):
    if name.suffix.lower() == '.ttf':
        print(name.name, name.stat().st_size, cmap(str(name), CPS))
    elif name.suffix.lower() == '.zip':
        data = name.read_bytes()
        print(name.name, len(data), data[:4])
        if data[:2] == b'PK':
            z = zipfile.ZipFile(io.BytesIO(data))
            for n in z.namelist():
                if n.lower().endswith('.ttf'):
                    tmp = OUT / '_tmp.ttf'
                    tmp.write_bytes(z.read(n))
                    print(' ', n, cmap(str(tmp), CPS))
                    tmp.unlink()
