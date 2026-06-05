# Running the Pool Dashboard

How the app is run and reached on the local network, and how to make it always-on.

## What it is

A Node.js (ESM) server that discovers the Pentair ScreenLogic gateway on the LAN and serves
a web dashboard. The **server is the brain** — it does the pool comms (UDP discovery + a
persistent TCP connection); browsers/phones are just clients of it.

- Start: `npm start` (runs `node src/index.js`)
- Tests: `npm test`
- Default web port: **3000** (override with the `PORT` env var)

## Access URLs (same Wi-Fi / LAN)

- Local: `http://localhost:3000`
- By IP: `http://192.168.1.50:3000`
- By name (Bonjour): **`http://pool.local:3000`** ← preferred

The Bonjour name comes from the Mac's Local Hostname (`espino` → `pool.local`), set in
System Settings → General → Sharing → Local hostname (or `sudo scutil --set LocalHostName espino`).
Works from Apple devices on the same Wi-Fi out of the box. Google/Nest Wifi does not support
custom local DNS names, so Bonjour `.local` is the route (no router DNS entry needed).

## Network / gateway facts

- The gateway is found via a **UDP broadcast to `255.255.255.255:1444`**; it replies with its
  IP/port/name (`Pentair: EE-59-51`). This broadcast is link-local — it never leaves the LAN.
- The working connection is a **persistent TCP session to the gateway at `192.168.1.20:80`**.
- Discovery and the host must be on the **same subnet** as the gateway (`192.168.1.x`).
- If broadcast discovery ever fails, set `POOL_GATEWAY_IP=192.168.1.20` to connect directly.

## Keep the same IP (DHCP reservation)

1. Pin the Mac's MAC so it won't rotate: System Settings → Wi-Fi → (network) → Details →
   **Private Wi-Fi Address → Fixed**. (Current Wi-Fi MAC: `AA:BB:CC:DD:EE:FF` — verify in
   settings; it's a private address.)
2. In the Google Home app → Wi-Fi → this device → reserve **`192.168.1.50`** to that MAC.

## Always-on on this Mac

A laptop **sleeps on lid-close/idle**, which takes the server offline. Keep it plugged in and
disable sleep: System Settings → Lock Screen / Displays → "prevent automatic sleeping on power
adapter" (or run under `caffeinate -s`).

Node is installed via nvm, so boot/login launchers need the **absolute** node path
(`~/.nvm/versions/node/v22.12.0/bin/node`).

### Option A — pm2 (simplest)
```
npm i -g pm2
pm2 start src/index.js --name pool
pm2 save
pm2 startup        # run the sudo command it prints, to start at boot
```

### Option B — launchd LaunchAgent
Save as `~/Library/LaunchAgents/com.espino.pool.plist`, then
`launchctl load ~/Library/LaunchAgents/com.espino.pool.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.espino.pool</string>
  <key>ProgramArguments</key>
  <array>
    <string>~/.nvm/versions/node/v22.12.0/bin/node</string>
    <string>~/workspace/pool/src/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>~/workspace/pool</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>~/workspace/pool/pool.log</string>
  <key>StandardErrorPath</key><string>~/workspace/pool/pool.log</string>
</dict>
</plist>
```
(The `processGuards` unhandled-rejection guard already keeps the process alive through the
node-screenlogic teardown quirk; pm2/launchd add boot-start + restart-on-exit.)

## Configuration (env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3000` | Web server port |
| `POOL_GATEWAY_NAME` | `EE-59-51` | Gateway to lock onto during discovery |
| `POOL_GATEWAY_IP` | (unset) | Manual fallback if broadcast discovery fails |
| `POOL_GATEWAY_PORT` | `80` | Gateway TCP port |
| `POOL_GATEWAY_PASSWORD` | `` (empty) | Local connections need none |
| `POLL_INTERVAL_MS` | `5000` | Status poll cadence |
| `DISCOVERY_TIMEOUT_MS` | `5000` | UDP discovery window |
| `POOL_PUMP_ID` | `1` | Pump id to poll (probed: only id 1 responds) |

## Security posture

LAN-only, plain **HTTP**, **no authentication** — deliberate, for a dashboard on a trusted
home Wi-Fi not exposed to the internet. Anyone on the Wi-Fi can reach it. If revisited:
- Encryption: `mkcert` (local CA + trusted cert) or a Caddy reverse proxy with `tls internal`.
- Access control: basic-auth middleware (only meaningful over HTTPS).
- Both + remote access in one: **Tailscale** (WireGuard encryption, device-level access,
  HTTPS via `tailscale serve`).

## Deferred / future

- Pump-speed adjustment (read-only today; needs pool volume + a pool pro — see `EQUIPMENT.md`).
- Schedule management (add/edit/delete).
- iPhone: add PWA manifest + icon for "Add to Home Screen"; or Tailscale for away-from-home access.
