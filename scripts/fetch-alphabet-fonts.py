#!/usr/bin/env python3
"""Fetch and convert alphabet fonts for the Alphabets tool."""
import io
import re
import urllib.request
import zipfile
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'fonts'


def download(url, dest, headers=None):
    req = urllib.request.Request(url, headers=headers or {'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as r:
        data = r.read()
    dest.write_bytes(data)
    return data


def to_woff2(ttf_path, woff2_path):
    from fontTools.ttLib.woff2 import compress
    compress(str(ttf_path), str(woff2_path))


def has_codepoints(ttf_path, cps):
    f = TTFont(ttf_path)
    cm = f.getBestCmap() or {}
    return {hex(cp): cp in cm for cp in cps}


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # Noto Sans Runic (already small valid file from github raw)
    noto_url = (
        'https://github.com/notofonts/runic/raw/main/fonts/NotoSansRunic/hinted/'
        'ttf/NotoSansRunic-Regular.ttf'
    )
    noto_ttf = OUT / 'NotoSansRunic-Regular.ttf'
    print('Downloading Noto Sans Runic...')
    download(noto_url, noto_ttf)
    to_woff2(noto_ttf, OUT / 'NotoSansRunic.woff2')
    print('Noto cmap', has_codepoints(noto_ttf, [0x16A6]))

    # Kreative open-relay: FairfaxHD (OFL) + Constructium — Klingon F8D0
    repo_url = 'https://github.com/kreativekorp/open-relay/archive/refs/heads/master.zip'
    print('Downloading open-relay fonts...')
    data = download(repo_url, OUT / '_open-relay.zip')
    z = zipfile.ZipFile(io.BytesIO(data))
    for src, dest_name in [
        ('open-relay-master/FairfaxHD/FairfaxHD.ttf', 'FairfaxHD.ttf'),
        ('open-relay-master/Constructium/Constructium.ttf', 'Constructium.ttf'),
    ]:
        (OUT / dest_name).write_bytes(z.read(src))
        to_woff2(OUT / dest_name, OUT / dest_name.replace('.ttf', '.woff2'))
        print(dest_name, has_codepoints(OUT / dest_name, [0xF8D0, 0x16A6, 0x16D06, 0x16D84]))

    # Tengwar Formal CSUR — parse SF redirect from saved HTML if present
    sf_html = OUT / 'TengwarFormalCSUR11.zip'
    if sf_html.exists():
        html = sf_html.read_text(encoding='utf-8', errors='ignore')
        m = re.search(r'url=(https://downloads\.sourceforge\.net[^"\s>]+)', html)
        if m:
            url = m.group(1).replace('&amp;', '&')
            print('Downloading Tengwar Formal CSUR from redirect...')
            td = download(url, OUT / 'tengwar-dl.zip')
            if td[:2] == b'PK':
                tz = zipfile.ZipFile(io.BytesIO(td))
                for name in tz.namelist():
                    if name.endswith('.ttf'):
                        ttf = OUT / 'TengwarFormalCSUR.ttf'
                        ttf.write_bytes(tz.read(name))
                        to_woff2(ttf, OUT / 'TengwarFormalCSUR.woff2')
                        print('TengwarFormalCSUR', has_codepoints(ttf, [0x16D06, 0x16D84]))
                        break

    (OUT / '_open-relay.zip').unlink(missing_ok=True)
    for junk in OUT.glob('TengwarFormal*.zip'):
        junk.unlink(missing_ok=True)
    for junk in ['Fairfax.ttf', 'Constructium.ttf', 'FairfaxHD.ttf', 'code2001']:
        p = OUT / junk
        if p.is_dir():
            import shutil
            shutil.rmtree(p, ignore_errors=True)
        elif p.suffix == '.ttf' and (OUT / p.name.replace('.ttf', '.woff2')).exists():
            p.unlink(missing_ok=True)

    print('Done.')


if __name__ == '__main__':
    main()
