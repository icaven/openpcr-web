# openpcr-web

A mobile web interface and REST API server for the [OpenPCR](https://openpcr.org/) thermocycler.
Designed to run on a Raspberry Pi connected to the OpenPCR device via USB, serving a phone- or
tablet-friendly UI over a local Wi-Fi hotspot — no internet connection required at run time.

The OpenPCR library is included as a git submodule ([icaven/OpenPyCR](https://github.com/icaven/OpenPyCR)).

---

## Features

- Mobile-friendly React UI — no build step; JSX runs in-browser via the Babel CDN (or a locally
  cached copy for offline use)
- REST API for program management (list, create, edit, delete) and device control (start, stop)
- Viewer and Operator roles with optional password protection
- Library of ready-to-use PCR programs (colony PCR, amplification, barcoding)
- Barcoding protocol templates (fish, fungi, invertebrates, plants and vertebrates)
- QR code generator for printing a connection card to attach to the instrument
- Raspberry Pi deployment guide: static IP, Wi-Fi hotspot, systemd auto-start, power-off button

---

## Requirements

- Python 3.10+
- An OpenPCR thermocycler connected via USB
- For Raspberry Pi deployment: Raspberry Pi OS (Bookworm or later recommended), `tmux`

No Node.js or npm required.

---

## Installation

```bash
git clone --recurse-submodules https://github.com/icaven/openpcr-web.git
cd openpcr-web
pip install -e .
```

If you cloned without `--recurse-submodules`, initialise the submodule afterwards:

```bash
git submodule update --init
```

---

## Running the web server

```bash
python web/serve.py              # serves on http://localhost:8080
python web/serve.py 8888         # custom port
python web/serve.py --operator-password secret   # require login to run programs
```

Open `http://localhost:8080/mobile.html` in a browser. The Programs page lists stored programs;
tap one to review or edit it, then tap **Run program** to send it to the device.

---

## Offline asset cache (required for Raspberry Pi hotspot use)

The UI loads React, Babel, and the Geist fonts from CDN URLs by default.
Users connecting via the Pi's Wi-Fi hotspot have no internet access, so run the download script
once on each new installation to cache those files locally:

```bash
python web/download_assets.py
```

This populates `web/vendor/` (~3.3 MB). The directory is excluded from git; re-run the script
after updating the repo.

---

## Generating a QR code connection card

```bash
python generate_qr_code.py --ip 10.0.0.1 --ssid OpenPCR --password openpcr1
```

This writes `openpcr_qr.svg` in the current directory — a printable page containing a QR code
for the mobile interface URL plus the Wi-Fi credentials. Open and print it:

```bash
xdg-open openpcr_qr.svg
```

Attach the printed sheet to the instrument so users can scan it to connect.

---

## Raspberry Pi deployment

See [`raspberry-pi-setup.md`](raspberry-pi-setup.md) for step-by-step instructions covering:

- Python virtual environment setup
- `systemd` service for auto-start on boot
- Static IP and Wi-Fi hotspot configuration
- Power-off button setup

Supporting docs:

- [`instructions-to-set-up-static-ip.md`](instructions-to-set-up-static-ip.md)
- [`instructions-to-set-up-wifi-hotspot.md`](instructions-to-set-up-wifi-hotspot.md)

---

## Repository structure

```
openpcr-web/
  openpycr/              git submodule — OpenPCR Python library
  web/
    serve.py             REST API server (stdlib http.server)
    app-mobile.jsx       React UI (single-file component)
    api.jsx              API client
    data.jsx             program data helpers
    mobile.html          HTML shell
    programs/            stored PCR programs (YAML)
    templates/           barcoding protocol templates (YAML)
    download_assets.py   offline asset cache script
  generate_qr_code.py    QR code + Wi-Fi card generator
  start_web_server.sh    tmux startup script for Raspberry Pi
  raspberry-pi-setup.md  Raspberry Pi deployment guide
  pyproject.toml
```

---

## Updating the library submodule

```bash
cd openpycr
git pull origin master
cd ..
git add openpycr
git commit -m "Update openpycr submodule"
```