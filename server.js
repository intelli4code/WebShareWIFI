import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';

const PORT = Number(process.env.PORT || 5174);
const DIST_DIR = path.resolve(process.cwd(), 'dist');

const CERT_PATH = process.env.TLS_CERT_PATH || path.resolve(process.cwd(), 'certs', 'cert.pem');
const KEY_PATH = process.env.TLS_KEY_PATH || path.resolve(process.cwd(), 'certs', 'key.pem');

function normalizeIp(raw) {
  if (!raw) return 'unknown';
  const s = String(raw);
  if (s.startsWith('::ffff:')) return s.slice('::ffff:'.length);
  if (s === '::1') return '127.0.0.1';
  return s;
}

function ipKeyFromHandshake(socket) {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (xff) {
    const ip = String(xff).split(',')[0].trim();
    return normalizeIp(ip);
  }
  return normalizeIp(socket.handshake.address);
}

function safeReadPresence(p) {
  return {
    displayName: typeof p?.displayName === 'string' ? p.displayName.slice(0, 60) : 'Unknown',
    avatarSeed: typeof p?.avatarSeed === 'string' ? p.avatarSeed.slice(0, 80) : 'seed'
  };
}

const app = express();

// Basic hardening for local use.
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Serve the built frontend.
app.use(express.static(DIST_DIR, { maxAge: '1h', etag: true, index: false }));

// Serve StreamSaver MITM + SW assets from node_modules.
app.use(
  '/streamsaver',
  express.static(path.resolve(process.cwd(), 'node_modules', 'streamsaver'), {
    maxAge: '1h',
    etag: true
  })
);

app.get('/', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));

const hasTlsFiles = fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH);

// For LAN/local: HTTPS is best.
// For cloud (Railway/Render/etc): TLS is typically terminated by the platform, so HTTP is fine.
const server = hasTlsFiles
  ? https.createServer(
      {
        cert: fs.readFileSync(CERT_PATH),
        key: fs.readFileSync(KEY_PATH)
      },
      app
    )
  : http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

// In-memory presence (socketId -> {displayName, avatarSeed, ipKey, roomId})
const presenceBySocketId = new Map();

function peersListForIpKey(effectiveKey, excludeSocketId) {
  const peers = [];
  for (const [socketId, p] of presenceBySocketId.entries()) {
    if (p.effectiveKey !== effectiveKey) continue;
    if (socketId === excludeSocketId) continue;
    peers.push({ socketId, displayName: p.displayName, avatarSeed: p.avatarSeed });
  }
  return peers;
}

function broadcastPeersUpdate(effectiveKey) {
  const room = `room:${effectiveKey}`;
  const peers = peersListForIpKey(effectiveKey, null);
  io.to(room).emit('peers:update', peers);
}

io.on('connection', (socket) => {
  const ipKey = ipKeyFromHandshake(socket);
  // Default join by IP. presence:hello can override this with a Room ID.
  socket.join(`room:${ipKey}`);

  socket.emit('self', { socketId: socket.id });

  socket.on('presence:hello', (payload) => {
    const safe = safeReadPresence(payload);
    const roomId = typeof payload?.roomId === 'string' && payload.roomId.trim() ? payload.roomId.trim() : null;
    
    // The 'effectiveKey' determines who you can see. 
    // It defaults to your IP, but is overridden by a Room ID.
    const effectiveKey = roomId || ipKey;

    // Leave any previous IP/Room rooms
    const prev = presenceBySocketId.get(socket.id);
    if (prev?.effectiveKey && prev.effectiveKey !== effectiveKey) {
      socket.leave(`room:${prev.effectiveKey}`);
    }

    socket.join(`room:${effectiveKey}`);
    presenceBySocketId.set(socket.id, { ...safe, ipKey, roomId, effectiveKey });
    
    console.log(`[Presence] ${safe.displayName} joined ${roomId ? `Room: ${roomId}` : `IP: ${ipKey}`}`);

    // Tell the client what their effective key is
    socket.emit('self:update', { socketId: socket.id, ipKey, roomId, effectiveKey });
    socket.emit('peers:update', peersListForIpKey(effectiveKey, socket.id));
    broadcastPeersUpdate(effectiveKey);
  });

  socket.on('presence:refresh', () => {
    const p = presenceBySocketId.get(socket.id);
    if (p) {
      socket.emit('peers:update', peersListForIpKey(p.effectiveKey, socket.id));
    }
  });

  socket.on('signal:send', (payload) => {
    const to = payload?.toSocketId;
    const signal = payload?.signal;
    if (typeof to !== 'string' || !to) return;
    io.to(to).emit('signal:receive', {
      fromSocketId: socket.id,
      signal
    });
  });

  socket.on('disconnect', () => {
    const prev = presenceBySocketId.get(socket.id);
    presenceBySocketId.delete(socket.id);
    if (prev?.effectiveKey) {
      broadcastPeersUpdate(prev.effectiveKey);
      console.log(`[Disconnect] ${prev.displayName} left ${prev.effectiveKey}`);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const proto = hasTlsFiles ? 'https' : 'http';
  console.log(`WebShareWIFI signaling server running at ${proto}://0.0.0.0:${PORT}`);
  console.log(`Serving dist from: ${DIST_DIR}`);
});

