## Setting up the Raspberry Pi as a WiFi Hotspot

> **Choose one approach:** this document configures the Pi as a WiFi *access point* with no
> existing network required. If the Pi will join an existing WiFi network instead, use
> [instructions-to-set-up-static-ip.md](instructions-to-set-up-static-ip.md) —
> the two configurations cannot be used together on the same interface.

This configures the Pi to broadcast its own WiFi network. Phones, tablets, and laptops connect
directly to the Pi — no router or existing network is required.

The Pi will use `10.0.0.1` as its own address and assign addresses to clients via DHCP. The web
interface will be reachable at `http://10.0.0.1:8080/mobile.html`.

---

### Raspberry Pi OS Bookworm and later (NetworkManager)

NetworkManager handles the DHCP server automatically when `ipv4.method shared` is set.

**1. Create a persistent hotspot connection**

```bash
sudo nmcli connection add \
  type wifi \
  ifname wlan0 \
  con-name "OpenPCR-Hotspot" \
  autoconnect yes \
  ssid "OpenPCR" \
  mode ap \
  ipv4.method shared \
  ipv4.addresses 10.0.0.1/24 \
  wifi-sec.key-mgmt sae \
  wifi-sec.pmf required \
  wifi-sec.psk "yourpassword"
```

Replace `yourpassword` with a password of your choice **(minimum 8 characters)**.

`wifi-sec.key-mgmt sae` uses WPA3, which eliminates offline dictionary attacks against the
password. **WPA3 AP mode requires a Raspberry Pi 4 or later** — the Pi 3's WiFi chip does not
support it and the hotspot will silently fail to start. If the hotspot fails, or if a connecting
device doesn't support WPA3 (devices made before ~2020), fall back to WPA2-only with AES by
modifying the connection with these security options instead:

```bash
sudo nmcli connection modify "OpenPCR-Hotspot" \
  wifi-sec.key-mgmt wpa-psk \
  wifi-sec.proto rsn \
  wifi-sec.pairwise ccmp \
  wifi-sec.group ccmp \
  wifi-sec.pmf disable
sudo nmcli -w 0 connection up "OpenPCR-Hotspot"
```

**2. Start the hotspot**

```bash
sudo nmcli -w 0 connection up "OpenPCR-Hotspot"
```

`-w 0` tells nmcli not to wait for a completion event — AP mode never sends one, which causes
the command to hang without it. The hotspot will start automatically on every boot because
`autoconnect yes` is set.

**3. Verify**

```bash
ip addr show wlan0
nmcli connection show "OpenPCR-Hotspot"
```

You should see `inet 10.0.0.1/24` on `wlan0`.

**4. To verify the password that was saved in the hotspot config:**                                                                                                                                            
                                                                                                                                                                                                          
```bash
 sudo nmcli -s connection show "OpenPCR-Hotspot" | grep psk                                                                                                                                              
```                                                                                                                                                                                                          
The `-s` flag exposes secrets. If the password shown isn't what you expect, update it:                                                                                                                    
                                                                                                                                                                                                          
```bash
  sudo nmcli connection modify "OpenPCR-Hotspot" wifi-sec.psk "yournewpassword"                                                                                                                           
  sudo nmcli -w 0 connection up "OpenPCR-Hotspot" 
```
---

### Raspberry Pi OS Bullseye and earlier (hostapd + dnsmasq)

**1. Install the required packages**

```bash
sudo apt update
sudo apt install hostapd dnsmasq
```

**2. Set a static IP on wlan0**

Add to `/etc/dhcpcd.conf`:

```bash
sudo nano /etc/dhcpcd.conf
```

```
interface wlan0
static ip_address=10.0.0.1/24
nohook wpa_supplicant
```

**3. Configure dnsmasq (DHCP server)**

Back up the default config and create a new one:

```bash
sudo mv /etc/dnsmasq.conf /etc/dnsmasq.conf.orig
sudo nano /etc/dnsmasq.conf
```

```
interface=wlan0
dhcp-range=10.0.0.2,10.0.0.50,255.255.255.0,24h
```

**4. Configure hostapd (access point)**

```bash
sudo nano /etc/hostapd/hostapd.conf
```

```
interface=wlan0
driver=nl80211
ssid=OpenPCR
hw_mode=g
channel=7
wmm_enabled=0
macaddr_acl=0
auth_algs=1
wpa=2
wpa_passphrase=yourpassword
wpa_key_mgmt=SAE
rsn_pairwise=CCMP
ieee80211w=2
```

Replace `yourpassword` with a password of your choice (minimum 8 characters).
`wpa_key_mgmt=SAE` and `ieee80211w=2` (required PMF) enable WPA3. If a connecting device fails
to join, fall back to WPA2-only by replacing those two lines with:

```
wpa_key_mgmt=WPA-PSK
ieee80211w=0
```

Point hostapd at this config file:

```bash
sudo nano /etc/default/hostapd
```

Find and set:

```
DAEMON_CONF="/etc/hostapd/hostapd.conf"
```

**5. Enable and start the services**

```bash
sudo systemctl unmask hostapd
sudo systemctl enable hostapd dnsmasq
sudo systemctl start hostapd dnsmasq
sudo systemctl restart dhcpcd
```

**6. Verify**

```bash
sudo systemctl status hostapd
sudo systemctl status dnsmasq
ip addr show wlan0
```

`wlan0` should show `inet 10.0.0.1/24` and `hostapd` should be active.

---

### Connecting from another device

On a phone, tablet, or laptop, open WiFi settings and connect to the `OpenPCR` network using
the password set above. Once connected, open:

```
http://10.0.0.1:8080/mobile.html
```
