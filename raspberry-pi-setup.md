These instructions set up the OpenPyCR web server so that it starts automatically whenever the
Raspberry Pi powers on. The web server lets you control and monitor the OpenPCR thermocycler from
a phone or tablet connected to the Pi's Wi-Fi hotspot.

### Step 1: Install tmux and a Python virtual environment

`tmux` keeps the web server running in the background even after you disconnect from the Pi.

```bash
sudo apt update
sudo apt install tmux
```

Create a Python virtual environment in the OpenPyCR directory and activate it:

```bash
python -m venv $HOME/openpcr-web/.venv --system-site-packages
source $HOME/openpcr-web/.venv/bin/activate
```

### Step 2: Make the startup script executable

The repository already includes `start_web_server.sh`. You need to mark it executable:

```bash
chmod +x $HOME/openpcr-web/start_web_server.sh
```

The script starts a `tmux` session named `web_server`, activates the virtual environment, loads
your password from `~/.env`, and launches the web server.

### Step 3: Create a systemd Service

`systemd` is the Linux service manager. The following creates a service unit file that tells the Pi
to run `start_web_server.sh` on every boot.

1. Create a new service file:

```bash
sudo nano /etc/systemd/system/start_web_service.service
```

2. Paste the following content into the file, then save and exit (`Ctrl-O`, `Enter`, `Ctrl-X`):

```systemd
[Unit]
Description=Start tmux session on boot for the web server for the OpenPCR interface
After=multi-user.target

[Service]
Type=oneshot
RemainAfterExit=true
Environment=HOME=/home/YOUR_USERNAME
Environment=PATH=/usr/bin:/bin
ExecStart=/home/YOUR_USERNAME/openpcr-web/start_web_server.sh
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/openpcr-web
EnvironmentFile=/home/YOUR_USERNAME/.env

Restart=on-failure

[Install]
WantedBy=multi-user.target
```

3. Replace `YOUR_USERNAME` with your actual Pi username (run this command — it fills it in
   automatically):

```bash
sudo sed -i "s|YOUR_USERNAME|$USER|g" /etc/systemd/system/start_web_service.service
```

### Step 4: Create the environment file and save in ~/.env

This file holds the operator password for the web interface. The systemd service reads it
automatically at startup. Generate a random password and write it to the file:

```bash
echo "SERVER_PASSWORD=$(openssl rand -hex 4)" >> ~/.env
```

`openssl rand -hex 4` produces 8 random hexadecimal characters (e.g. `a3f2c91b`).
Review or change this password before starting the service — it controls access to the web
interface.

### Step 5: Download local copies of web assets

The web interface uses React, Babel, and the Geist fonts. By default, these load from CDN URLs,
but users connecting via the Pi's Wi-Fi hotspot may have no internet access, so the Pi
must serve these assets locally.

Run the download script once after cloning or updating the repository:

```bash
cd $HOME/openpcr-web
python3 web/download_assets.py
```

This populates `web/vendor/` with the JS libraries and font files (about 3.3 MB total).
The script only downloads files that are not already present, so it is safe to re-run.
`web/vendor/` is excluded from git — you must run the script on each new Pi installation.

### Step 6: Allow the web server to shut down the Pi

The web interface includes a "Power off" button (visible to logged-in operators) that calls
`sudo shutdown -h now`. Grant the Pi user passwordless permission for that one command:

```bash
echo "$(whoami) ALL=(ALL) NOPASSWD: /sbin/shutdown" | sudo tee /etc/sudoers.d/openpycr-shutdown
sudo chmod 440 /etc/sudoers.d/openpycr-shutdown
```

Verify with `sudo visudo -c` — it should print "parsed OK".

### Step 7: Enable the Service

Enable the service so that it starts on boot:

```bash
sudo systemctl enable start_web_service.service
```

For development, you can also enable/disable/start/stop/status the service manually:
```bash
sudo systemctl stop start_web_service.service
sudo systemctl disable start_web_service.service
sudo systemctl status start_web_service.service
sudo systemctl start start_web_service.service

# If the service previously failed (e.g. the script was not yet executable), clear the
# failure counter before starting again:
sudo systemctl reset-failed start_web_service.service
sudo systemctl start start_web_service.service
```

You can check the result with `sudo systemctl status start_web_service.service`.

For troubleshooting, view the service log with:
```bash
sudo journalctl -u start_web_service.service -n 50
```

### Step 8: Reboot

```bash
sudo reboot
```

### Step 9: Verify

After the reboot, confirm the `tmux` session is running:

```bash
tmux ls
```

You should see `web_server` listed. To watch the server output in real time, attach to the session:

```bash
tmux attach -t web_server
```

Press `Ctrl-B` then `D` to detach without stopping the server.

Open a browser on a device connected to the Pi's Wi-Fi hotspot and navigate to
`http://<pi-ip-address>:8080/mobile.html`. Log in with the operator password from `~/.env`
to access run controls and the Power off button.

### Step 10: Print and attach the QR code

`generate_qr_code.py` creates a printable SVG containing a QR code for the mobile interface
URL, along with the Wi-Fi network name and password — so users can connect and navigate to the
interface by scanning a single code.

Then generate the SVG, substituting your Pi's IP address, hotspot network name, and hotspot
password:

```bash
cd $HOME/openpcr-web
python generate_qr_code.py --ip 10.0.0.1 --ssid OpenPCR --password openpcr1
```

This writes `openpcr_qr.svg` in the current directory. Open it in a web browser and print it:

```bash
xdg-open openpcr_qr.svg   # opens in the default viewer / browser
```

Print the page and attach it to the instrument so users can scan it to connect.
