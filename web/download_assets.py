#!/usr/bin/env python3
"""Download all CDN assets needed by mobile.html for offline / hotspot use.

Run once (or after updating library versions) from the repo root or web/:
    python web/download_assets.py

Output
------
web/vendor/
  react.js           — React 18 UMD production build
  react-dom.js       — ReactDOM 18 UMD production build
  babel.js           — Babel standalone (JSX transformer)
  fonts/
    fonts.css        — Google Fonts CSS rewritten to use local paths
    *.woff2          — Geist and Geist Mono font files
"""
import re
import sys
import urllib.request
from pathlib import Path

VENDOR = Path(__file__).parent / 'vendor'
FONTS_DIR = VENDOR / 'fonts'

JS_ASSETS = [
    ('react.js',     'https://unpkg.com/react@18.3.1/umd/react.production.min.js'),
    ('react-dom.js', 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js'),
    ('babel.js',     'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js'),
]

FONTS_CSS_URL = (
    'https://fonts.googleapis.com/css2'
    '?family=Geist:wght@400;500;600;700'
    '&family=Geist+Mono:wght@400;500;600'
    '&display=swap'
)

# Modern browser UA so Google Fonts serves woff2 (not woff/ttf).
_BROWSER_UA = (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
)


def _fetch(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def _size_str(path):
    kb = path.stat().st_size / 1024
    return f'{kb:.0f} KB' if kb >= 1 else f'{path.stat().st_size} B'


def download_js():
    VENDOR.mkdir(exist_ok=True)
    for name, url in JS_ASSETS:
        dest = VENDOR / name
        print(f'  {url}')
        dest.write_bytes(_fetch(url))
        print(f'    → vendor/{name} ({_size_str(dest)})')


def download_fonts():
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    print(f'  {FONTS_CSS_URL}')
    css = _fetch(FONTS_CSS_URL, headers={'User-Agent': _BROWSER_UA}).decode()

    font_urls = re.findall(r'url\((https://fonts\.gstatic\.com[^)]+)\)', css)
    seen = {}
    for font_url in font_urls:
        if font_url in seen:
            continue
        # Use the last path segment as the local filename (already unique per weight).
        filename = font_url.rsplit('/', 1)[-1].split('?')[0]
        dest = FONTS_DIR / filename
        if not dest.exists():
            print(f'  {font_url}')
            dest.write_bytes(_fetch(font_url))
            print(f'    → vendor/fonts/{filename} ({_size_str(dest)})')
        css = css.replace(font_url, f'/vendor/fonts/{filename}')
        seen[font_url] = filename

    css_dest = FONTS_DIR / 'fonts.css'
    css_dest.write_text(css)
    print(f'    → vendor/fonts/fonts.css')


if __name__ == '__main__':
    print('Downloading JS assets...')
    try:
        download_js()
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)

    print('Downloading font assets...')
    try:
        download_fonts()
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)

    print('Done. Run the web server and reload mobile.html to verify.')
