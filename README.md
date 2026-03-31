# WebShareWIFI

Browser-based **P2P file sharing on a local WiFi** network.

- **Discovery**: Socket.io groups users by **public IP** (devices behind the same NAT/WiFi see each other) and shows random avatars/names.
- **Transfer**: WebRTC **DataChannel** via `simple-peer`.
- **Reliability**: 64KB chunking + DataChannel backpressure.
- **Large files**: uses **StreamSaver** to stream downloads to disk (no huge in-memory blobs).

## Requirements

- Node.js 20+ (works with Node 22)
- Two devices on the same WiFi (for real testing)

## Setup (Windows / PowerShell)

Install deps:

```bash
npm install
```

Build the frontend:

```bash
npm run build
```

## HTTPS certificates (required for best LAN compatibility)

This app serves **HTTPS by default** from `server.js`. Create a self-signed cert in `./certs`:

```powershell
mkdir certs -ErrorAction SilentlyContinue

# Create a self-signed cert + export to PEM.
$cert = New-SelfSignedCertificate `
  -DnsName "localhost" `
  -CertStoreLocation "Cert:\\CurrentUser\\My" `
  -FriendlyName "WebShareWIFI Local"

$pwd = ConvertTo-SecureString -String "changeit" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath ".\\certs\\cert.pfx" -Password $pwd | Out-Null

# Convert PFX -> PEM (requires OpenSSL)
openssl pkcs12 -in ".\\certs\\cert.pfx" -nocerts -out ".\\certs\\key.pem" -nodes -password pass:changeit
openssl pkcs12 -in ".\\certs\\cert.pfx" -clcerts -nokeys -out ".\\certs\\cert.pem" -password pass:changeit
```

If you don’t have OpenSSL on Windows, install it (or use Git for Windows’ `openssl.exe`).

### Use your LAN IP (recommended)

1. Find your LAN IP (example `192.168.1.50`).
2. Open `https://192.168.1.50:5174` on both devices.

**Note**: the cert above is for `localhost`. Browsers will show a warning when using the LAN IP unless your cert includes that IP/hostname. For local testing, you can proceed through the warning.

If you want fewer warnings, generate a cert for your LAN hostname / IP (recommended tool: `mkcert`).

## Run

Start the signaling server:

```bash
npm run serve
```

Then open:

- `https://localhost:5174`
- or `https://<your-lan-ip>:5174` from another device on the same WiFi.

## Deploy to Netlify (frontend) + Railway (signaling server) — shortest path

### 1) Deploy the frontend to Netlify

1. Push this repo to GitHub.
2. In Netlify: **Add new site** → **Import from Git**.
3. Build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
4. Add a Netlify environment variable (Site settings → Build & deploy → Environment):
   - **`VITE_SIGNALING_URL`** = `https://<your-railway-app>.up.railway.app`

This repo already includes `netlify.toml` for SPA routing, and the build copies StreamSaver assets to `dist/streamsaver` automatically.

### 2) Deploy the signaling server to Railway

1. Create a new Railway project → **Deploy from GitHub repo**.
2. In Railway Variables, set (optional but recommended):
   - `NODE_ENV=production`
   - Railway will provide `PORT` automatically.
3. Start command:
   - `npm run serve`

Notes:
- On Railway, TLS is usually terminated by the platform. `server.js` will automatically run **HTTP** if no `certs/` exist.
- Ensure the Railway service has WebSockets enabled (default).

### 3) Test

- Open the Netlify site on two devices on the same WiFi.
- They should discover each other (same public IP) and transfers should stream to disk.

## How it works

### Discovery (same public IP)

- When a socket connects, the server derives an `ipKey` from `x-forwarded-for` or the socket address.
- All sockets with the same `ipKey` are in the same room.
- Clients broadcast `presence:hello` with `{displayName, avatarSeed}` and receive `peers:update`.

### Signaling

- `simple-peer` emits SDP/ICE via `peer.on('signal')`.
- Client forwards those blobs over Socket.io: `signal:send {toSocketId, signal}`.
- Server forwards to the target via `signal:receive`.

### Transfers

- Sender sends `FILE_META`, then for each chunk sends `FILE_CHUNK` (JSON) + the binary chunk, then `FILE_END`.
- Receiver uses StreamSaver to write chunks directly to disk.

## Troubleshooting

- **No peers appear**: ensure both devices are on the same WiFi and opened the same `https://<lan-ip>:5174`. Also ensure Windows Firewall allows inbound TCP on port `5174`.\n- **WebRTC connects but stalls**: try moving devices closer to the router; disable VPNs; ensure both tabs stay awake.\n- **HTTPS warnings**: expected with self-signed certs. Use `mkcert` for a nicer local-dev experience.\n- **Moderate npm audit warnings**: this is common in frontend stacks; you can try `npm audit` to inspect.\n+
## Files you asked for (deliverables)

- `server.js`: signaling server + discovery + static hosting\n- `src/client.js`: WebRTC + chunked transfer + StreamSaver integration\n- `dist/index.html`, `dist/client.js`, `dist/styles.css`: production build output\n+
