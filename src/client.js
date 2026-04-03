import io from 'socket.io-client';
import Peer from 'simple-peer';
import streamSaver from 'streamsaver';

const CHUNK_SIZE = 256 * 1024; // 256KB (Max safe Chrome limit, better throughput)
const BUFFER_HIGH_WATER = 32 * 1024 * 1024; // 32MB (Higher saturation for speed)
const BUFFER_LOW_WATER = 8 * 1024 * 1024; // 8MB (Resume sooner to keep pipe full)

function randItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeDisplayName() {
  const a = ['Swift', 'Nova', 'Silent', 'Happy', 'Pixel', 'Brave', 'Cloud', 'Solar', 'Lucky', 'Neon', 'Calm'];
  const b = ['Otter', 'Falcon', 'Panda', 'Tiger', 'Koala', 'Lynx', 'Dolphin', 'Fox', 'Orca', 'Hawk', 'Turtle'];
  return `${randItem(a)} ${randItem(b)} ${Math.floor(10 + Math.random() * 90)}`;
}

function makeAvatarSeed() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultSignalingUrl() {
  // If frontend is hosted separately (e.g., Netlify) set VITE_SIGNALING_URL to your signaling server (e.g., Railway).
  return import.meta.env.VITE_SIGNALING_URL || window.location.origin;
}

export function createWebShareClient(handlers) {
  const onSelf = handlers?.onSelf ?? (() => {});
  const onPeers = handlers?.onPeers ?? (() => {});
  const onPeerStatus = handlers?.onPeerStatus ?? (() => {});
  const onSendProgress = handlers?.onSendProgress ?? (() => {});
  const onReceiveProgress = handlers?.onReceiveProgress ?? (() => {});
  const onToast = handlers?.onToast ?? (() => {});

  const state = {
    socket: null,
    self: {
      socketId: null,
      displayName: makeDisplayName(),
      avatarSeed: makeAvatarSeed()
    },
    peers: [],
    peerBySocketId: new Map(), // peerSocketId -> { peer, dataChannel }
    activeReceives: new Map(), // id -> { writer, bytesReceived, totalBytes, fileName }
    roomId: null
  };

  // StreamSaver requires a MITM page + SW.
  // server.js exposes node_modules/stream-saver at /streamsaver
  streamSaver.mitm = `${window.location.origin}/streamsaver/mitm.html`;

  function setPeers(list) {
    state.peers = Array.isArray(list) ? list : [];
    onPeers(state.peers);
  }

  function connect(roomId = null) {
    const url = defaultSignalingUrl();
    console.log(`[Client] Connecting to signaling server: ${url}${roomId ? ` (Room: ${roomId})` : ''}`);
    
    state.roomId = roomId;

    const socket = io(url, {
      transports: ['websocket'],
      secure: url.startsWith('https:'),
      reconnection: true
    });
    state.socket = socket;

    socket.on('connect', () => {
      state.self.socketId = socket.id;
      onSelf({ ...state.self, roomId: state.roomId });
      socket.emit('presence:hello', { 
        displayName: state.self.displayName, 
        avatarSeed: state.self.avatarSeed,
        roomId: state.roomId
      });
      onToast(state.roomId ? `Joined Room: ${state.roomId}` : 'Connected. Discovery active.');
    });

    socket.on('disconnect', () => {
      onToast('Disconnected from signaling server.');
      setPeers([]);
    });

    socket.on('self', (payload) => {
      if (payload?.socketId && !state.self.socketId) {
        state.self.socketId = payload.socketId;
        onSelf({ ...state.self });
      }
    });

    socket.on('self:update', (payload) => {
      console.log(`[Client] Self update from server:`, payload);
      state.self = { ...state.self, ...payload };
      onSelf({ ...state.self });
    });

    socket.on('peers:update', (peers) => {
      setPeers((peers ?? []).filter((p) => p?.socketId && p.socketId !== socket.id));
    });

    socket.on('signal:receive', async (payload) => {
      const from = payload?.fromSocketId;
      const signal = payload?.signal;
      if (!from) return;

      let entry = state.peerBySocketId.get(from);
      if (!entry) {
        entry = createPeerConnection(from, false);
        state.peerBySocketId.set(from, entry);
      }

      try {
        entry.peer.signal(signal);
      } catch (e) {
        onToast(`Signal error: ${e?.message ?? e}`);
      }
    });
  }

  function destroy() {
    for (const { peer } of state.peerBySocketId.values()) {
      try {
        peer.destroy();
      } catch {}
    }
    state.peerBySocketId.clear();

    try {
      state.socket?.disconnect();
    } catch {}
    state.socket = null;
  }

  function reannounce(roomId = null) {
    state.roomId = roomId || state.roomId;
    state.socket?.emit('presence:hello', { 
      displayName: state.self.displayName, 
      avatarSeed: state.self.avatarSeed,
      roomId: state.roomId
    });
    state.socket?.emit('presence:refresh');
  }

  function disconnectFromPeer(peerSocketId) {
    if (!peerSocketId) return;
    const entry = state.peerBySocketId.get(peerSocketId);
    if (!entry) return;
    try {
      entry.peer.destroy();
    } catch {}
    state.peerBySocketId.delete(peerSocketId);
    onPeerStatus(peerSocketId, 'available');
  }

  function connectToPeer(peerSocketId) {
    if (!peerSocketId) return;
    let entry = state.peerBySocketId.get(peerSocketId);
    if (entry && !entry.peer.destroyed) return;

    entry = createPeerConnection(peerSocketId, true);
    state.peerBySocketId.set(peerSocketId, entry);
  }

  function createPeerConnection(peerSocketId, initiator) {
    console.log(`[WebRTC] Creating connection to ${peerSocketId} (initiator: ${initiator})`);
    
    const peer = new Peer({
      initiator,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });

    onPeerStatus(peerSocketId, initiator ? 'connecting' : 'incoming');

    peer.on('signal', (signal) => {
      state.socket?.emit('signal:send', { toSocketId: peerSocketId, signal });
    });

    peer.on('connect', () => {
      onPeerStatus(peerSocketId, 'connected');
      onToast(`Connected to ${peerSocketId.slice(0, 6)}.`);
      try {
        const dc = peer._channel;
        if (dc) {
          dc.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
        }
      } catch {}
    });

    peer.on('close', () => {
      onPeerStatus(peerSocketId, 'available');
    });

    peer.on('error', (err) => {
      onPeerStatus(peerSocketId, 'error');
      onToast(`Peer error: ${err?.message ?? err}`);
    });

    peer.on('data', async (data) => {
      // Backpressure: pause WebRTC stream while processing/writing to disk
      peer.pause();
      try {
        await onData(peerSocketId, data);
      } finally {
        peer.resume();
      }
    });

    return { peer };
  }

  async function sendFile(peerSocketId, file) {
    if (!file) return;
    let entry = state.peerBySocketId.get(peerSocketId);
    if (!entry || entry.peer.destroyed) {
      connectToPeer(peerSocketId);
      entry = state.peerBySocketId.get(peerSocketId);
    }

    const peer = entry?.peer;
    if (!peer) return;

    // Wait until connected.
    for (let i = 0; i < 120; i++) {
      if (peer.connected) break;
      await wait(50);
    }
    if (!peer.connected) {
      onToast('Not connected yet. Try again in a moment.');
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const meta = {
      t: 'FILE_META',
      id,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      chunkSize: CHUNK_SIZE
    };
    peer.send(JSON.stringify(meta));

    const totalBytes = file.size;
    let bytesSent = 0;
    onSendProgress({ bytesSent, totalBytes, fileName: file.name });

    const dc = peer._channel;
    const totalChunks = Math.ceil(totalBytes / CHUNK_SIZE);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(totalBytes, start + CHUNK_SIZE);
      const buf = await file.slice(start, end).arrayBuffer();

      // Backpressure: pause when bufferedAmount is high.
      while (dc && dc.bufferedAmount > BUFFER_HIGH_WATER) {
        await new Promise((resolve) => {
          const onLow = () => {
            dc.removeEventListener('bufferedamountlow', onLow);
            resolve();
          };
          dc.addEventListener('bufferedamountlow', onLow, { once: true });
          setTimeout(() => {
            try {
              dc.removeEventListener('bufferedamountlow', onLow);
            } catch {}
            resolve();
          }, 250);
        });
      }

      peer.send(buf);
      bytesSent += buf.byteLength;
      
      const now = Date.now();
      if (!file._lastProgress || now - file._lastProgress > 100 || chunkIndex === totalChunks - 1) {
        file._lastProgress = now;
        onSendProgress({ bytesSent, totalBytes, fileName: file.name });
      }
    }

    peer.send(JSON.stringify({ t: 'FILE_END', id, totalChunks }));
    onToast(`Sent: ${file.name}`);
  }

  async function onData(peerSocketId, data) {
    let textData = null;
    if (typeof data === 'string') {
      textData = data;
    } else if (data && (data instanceof Uint8Array || data instanceof ArrayBuffer || (data.constructor && data.constructor.name === 'Buffer'))) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
      // 123 is '{' in ASCII. Only try to parse UTF-8 JSON if it starts with '{'
      if (bytes.length > 0 && bytes[0] === 123) {
        try {
          const str = new TextDecoder().decode(bytes);
          if (str.includes('"t":')) {
            textData = str;
          }
        } catch {}
      }
    }

    if (textData) {
      const msg = safeJsonParse(textData);
      if (msg?.t) {
        if (msg.t === 'FILE_META') {
          const { id, name, size } = msg;
          if (!id || !name || !Number.isFinite(size)) return;

          onToast(`Receiving: ${name}`);
          onReceiveProgress({ bytesReceived: 0, totalBytes: size, fileName: name });

          const fileStream = streamSaver.createWriteStream(name, { size });
          const writer = fileStream.getWriter();
          state.activeReceives.set(id, {
            writer,
            bytesReceived: 0,
            totalBytes: size,
            fileName: name
          });
          return;
        }

        if (msg.t === 'FILE_END') {
          const rec = state.activeReceives.get(msg.id);
          if (!rec) return;
          try {
            await rec.writer.close();
          } catch {}
          state.activeReceives.delete(msg.id);
          
          // Force a final 100% progress update
          onReceiveProgress({ bytesReceived: rec.totalBytes, totalBytes: rec.totalBytes, fileName: rec.fileName });
          
          onToast(`Saved: ${rec.fileName}`);
          return;
        }
        
        // Unrecognized control message, ignore
        return;
      }
    }

    // Binary chunk: apply to the most recently created transfer
    const last = Array.from(state.activeReceives.entries()).slice(-1)[0];
    if (!last) return;
    const [id, rec] = last;

    const chunk = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    try {
      await rec.writer.write(chunk);
      rec.bytesReceived += chunk.byteLength;

      const now = Date.now();
      if (!rec.lastProgressTime || now - rec.lastProgressTime > 100 || rec.bytesReceived >= rec.totalBytes) {
        rec.lastProgressTime = now;
        onReceiveProgress({ bytesReceived: rec.bytesReceived, totalBytes: rec.totalBytes, fileName: rec.fileName });
      }
    } catch (e) {
      onToast(`Write failed: ${e?.message ?? e}`);
      try {
        await rec.writer.abort();
      } catch {}
      state.activeReceives.delete(id);
    }
    // state.socket? no; ACK would go over datachannel. Keeping protocol simple.
    void peerSocketId;
  }

  return {
    connect,
    destroy,
    reannounce,
    connectToPeer,
    disconnectFromPeer,
    sendFile,
    getSelf: () => ({ ...state.self }),
    getPeers: () => [...state.peers]
  };
}

