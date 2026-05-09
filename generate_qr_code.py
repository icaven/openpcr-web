#!/usr/bin/env python3
"""Generate an SVG page with a QR code and WiFi details for the OpenPCR web interface."""

import argparse
import io
import xml.etree.ElementTree as ET
from pathlib import Path

import segno

_SVG_NS = 'http://www.w3.org/2000/svg'


def _qr_svg_elements(url: str, scale_mm: float) -> tuple[float, float, str]:
    """Return (width_mm, height_mm, inner_svg_content) for a QR code."""
    ET.register_namespace('', _SVG_NS)
    buf = io.BytesIO()
    segno.make_qr(url, error='H').save(buf, kind='svg', unit='mm', scale=scale_mm)
    buf.seek(0)
    root = ET.parse(buf).getroot()
    w = float(root.get('width', '0mm')[:-2])
    h = float(root.get('height', '0mm')[:-2])
    inner = ''.join(ET.tostring(child, encoding='unicode') for child in root)
    return w, h, inner


def build_page_svg(url: str, ssid: str, password: str, scale_mm: float, title: str) -> str:
    qr_w, qr_h, qr_inner = _qr_svg_elements(url, scale_mm)

    margin = 10.0
    title_size = 5.5
    info_size = 4.5
    line_gap = 7.0

    title_y = margin + title_size
    qr_top = title_y + 6.0
    url_y = qr_top + qr_h + 6.0
    ssid_y = url_y + line_gap
    pwd_y = ssid_y + line_gap

    page_w = qr_w + 2 * margin
    page_h = pwd_y + info_size + margin
    cx = page_w / 2

    return '\n'.join([
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="{_SVG_NS}"',
        f'     width="{page_w:.1f}mm" height="{page_h:.1f}mm"',
        f'     viewBox="0 0 {page_w:.1f} {page_h:.1f}">',
        f'  <rect width="{page_w:.1f}" height="{page_h:.1f}" fill="white"/>',
        f'  <text x="{cx:.1f}" y="{title_y:.1f}" text-anchor="middle"',
        f'        font-family="sans-serif" font-size="{title_size}" font-weight="bold">{title}</text>',
        f'  <g transform="translate({margin:.1f},{qr_top:.1f})">',
        f'    {qr_inner}',
        f'  </g>',
        f'  <text x="{cx:.1f}" y="{url_y:.1f}" text-anchor="middle"',
        f'        font-family="monospace" font-size="{info_size}">{url}</text>',
        f'  <text x="{cx:.1f}" y="{ssid_y:.1f}" text-anchor="middle"',
        f'        font-family="sans-serif" font-size="{info_size}">',
        f'    <tspan font-weight="bold">WiFi Network: </tspan>{ssid}',
        f'  </text>',
        f'  <text x="{cx:.1f}" y="{pwd_y:.1f}" text-anchor="middle"',
        f'        font-family="sans-serif" font-size="{info_size}">',
        f'    <tspan font-weight="bold">Password: </tspan>{password}',
        f'  </text>',
        '</svg>',
    ])


def main():
    parser = argparse.ArgumentParser(description='Generate OpenPCR QR code page as SVG')
    parser.add_argument('--ip', default='10.0.0.1',
                        help='Server IP address (default: 10.0.0.1)')
    parser.add_argument('--port', default=8080, type=int,
                        help='Server port (default: 8080)')
    parser.add_argument('--ssid', default='OpenPCR',
                        help='WiFi network name (default: OpenPCR)')
    parser.add_argument('--password', default='openpcr1',
                        help='WiFi password (default: openpcr1)')
    parser.add_argument('--title', default='Scan to connect to the OpenPCR thermocycler',
                        help='Page title text')
    parser.add_argument('--scale', default=3.0, type=float,
                        help='QR code module size in mm (default: 3.0)')
    parser.add_argument('--output', default='openpcr_qr.svg',
                        help='Output SVG file (default: openpcr_qr.svg)')
    args = parser.parse_args()

    url = f'http://{args.ip}:{args.port}/mobile.html'
    svg = build_page_svg(url, args.ssid, args.password, args.scale, args.title)
    output = Path(args.output)
    output.write_text(svg, encoding='utf-8')
    print(f'Saved: {output}')
    print(f'URL:   {url}')


if __name__ == '__main__':
    main()
