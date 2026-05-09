## Setting a Static IP Address on a Raspberry Pi (Wireless)

> **Choose one approach:** this document configures the Pi as a WiFi *client* on an existing
> network. If no existing network is available, use
> [instructions-to-set-up-wifi-hotspot.md](instructions-to-set-up-wifi-hotspot.md) instead —
> the two configurations cannot be used together on the same interface.

A static IP in the `10.0.0.x` subnet is recommended. This avoids conflicts with typical home
routers, which use `192.168.0.x` or `192.168.1.x`.

A suggested address is `10.0.0.10/24`. The connecting laptop or tablet connects to the same
WiFi network; no static IP configuration is needed on the connecting device since the router
(or the Pi's own hotspot, if configured) handles address assignment.

> For a fully standalone setup with no existing WiFi network, see
> [instructions-to-set-up-wifi-hotspot.md](instructions-to-set-up-wifi-hotspot.md).

---

### Raspberry Pi OS Bookworm and later (NetworkManager)

Bookworm replaced `dhcpcd` with NetworkManager. Use `nmcli` to configure the interface.

**1. Find the wireless connection name**

```bash
nmcli connection show
```

The wireless connection name is usually the WiFi network SSID (e.g. `MyNetwork`).

**2. Set the static IP**

```bash
nmcli connection modify "MyNetwork" \
  ipv4.method manual \
  ipv4.addresses 10.0.0.10/24 \
  ipv4.gateway "" \
  ipv4.dns ""
```

Replace `MyNetwork` with the actual SSID. Omit gateway and DNS — they are not needed for a
direct-network connection.

**3. Apply the change**

```bash
nmcli connection up "MyNetwork"
```

**4. Verify**

```bash
ip addr show wlan0
```

You should see `inet 10.0.0.10/24` in the output.

---

### Raspberry Pi OS Bullseye and earlier (dhcpcd)

**1. Edit the dhcpcd configuration**

```bash
sudo nano /etc/dhcpcd.conf
```

**2. Add the following lines at the end of the file**

```
interface wlan0
static ip_address=10.0.0.10/24
```

No `static routers` or `static domain_name_servers` lines are needed.

**3. Restart dhcpcd**

```bash
sudo systemctl restart dhcpcd
```

**4. Verify**

```bash
ip addr show wlan0
```

---

### Connecting from another device

Connect the laptop or tablet to the same WiFi network. No manual IP configuration is needed —
the network will assign an address automatically.

Once connected, open the OpenPCR web interface at:

```
http://10.0.0.10:8080/mobile.html
```

---

### Verifying connectivity

From the connecting device:

```bash
ping 10.0.0.10
```
