import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createWebShareClient } from './client.js';

function hashToAngleDegrees(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 3600) / 10;
}

function seededColor(seed) {
  const angle = hashToAngleDegrees(seed);
  return `hsl(${angle}, 85%, 58%)`;
}

function initials(name) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join('');
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function ProgressBar({ value, max }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div className="h-full rounded-full bg-emerald-400 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function App() {
  const [self, setSelf] = useState(null);
  const [peers, setPeers] = useState([]);
  const [selectedPeerId, setSelectedPeerId] = useState(null);
  const [statusByPeerId, setStatusByPeerId] = useState({});
  const [fileToSend, setFileToSend] = useState(null);
  const [sendProgress, setSendProgress] = useState({ bytesSent: 0, totalBytes: 0, fileName: '' });
  const [recvProgress, setRecvProgress] = useState({ bytesReceived: 0, totalBytes: 0, fileName: '' });
  const [toast, setToast] = useState('');

  const clientRef = useRef(null);

  useEffect(() => {
    const client = createWebShareClient({
      onSelf: (s) => setSelf(s),
      onPeers: (list) => setPeers(list),
      onPeerStatus: (peerId, nextStatus) =>
        setStatusByPeerId((prev) => ({ ...prev, [peerId]: nextStatus })),
      onSendProgress: (p) => setSendProgress(p),
      onReceiveProgress: (p) => setRecvProgress(p),
      onToast: (msg) => {
        setToast(msg);
        window.clearTimeout(clientRef.current?._toastTimer);
        clientRef.current._toastTimer = window.setTimeout(() => setToast(''), 2600);
      }
    });

    clientRef.current = client;
    client.connect();
    return () => client.destroy();
  }, []);

  const selectedPeer = useMemo(() => peers.find((p) => p.socketId === selectedPeerId) ?? null, [peers, selectedPeerId]);

  const radarPeers = useMemo(() => {
    const usable = peers.slice(0, 12);
    const r = 148;
    return usable.map((p) => {
      const a = (hashToAngleDegrees(p.socketId) * Math.PI) / 180;
      return {
        peer: p,
        x: Math.cos(a) * r,
        y: Math.sin(a) * r
      };
    });
  }, [peers]);

  function onPickFiles(files) {
    const f = files?.[0];
    if (!f) return;
    setFileToSend(f);
    setSendProgress({ bytesSent: 0, totalBytes: f.size, fileName: f.name });
  }

  async function connectTo(peerId) {
    setSelectedPeerId(peerId);
    await clientRef.current?.connectToPeer(peerId);
  }

  async function sendFile() {
    if (!fileToSend || !selectedPeerId) {
      setToast('Pick a file and choose a peer.');
      return;
    }
    await clientRef.current?.sendFile(selectedPeerId, fileToSend);
  }

  const container = (
    <div className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/20 ring-1 ring-white/10">
               <div className={`h-2 w-2 rounded-full ${self?.socketId ? 'bg-emerald-400' : 'bg-red-400'}`} />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">WebShareWIFI</div>
              <div className="text-sm text-white/60">
                {self?.socketId ? 'Connected to signaling' : 'Connecting to signaling...'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-2 ring-1 ring-white/10">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-xl text-xs font-semibold text-slate-950"
              style={{ backgroundColor: seededColor(self?.avatarSeed ?? 'self') }}
              title={self?.displayName ?? 'You'}
            >
              {initials(self?.displayName ?? 'You')}
            </div>
            <div className="text-sm">
              <div className="font-medium">{self?.displayName ?? 'Connecting…'}</div>
              <div className="text-xs text-white/60">{self?.socketId ? `ID: ${self.socketId.slice(0, 6)}` : '—'}</div>
            </div>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-3xl bg-white/5 p-4 ring-1 ring-white/10 sm:p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Discovery</div>
                <div className="text-xs text-white/60">
                  {peers.length} peer(s) found
                  <span className="ml-1 opacity-50">
                    ({self?.roomId ? `Room: ${self.roomId}` : `Subnet: ${self?.ipKey || '...'}`})
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Room ID (Optional)"
                  className="w-24 rounded-xl bg-white/10 px-3 py-2 text-xs ring-1 ring-white/10 focus:outline-none focus:ring-emerald-400/50"
                  onBlur={(e) => clientRef.current?.reannounce(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && clientRef.current?.reannounce(e.target.value)}
                  defaultValue={self?.roomId || ''}
                />
                <button
                  onClick={() => clientRef.current?.reannounce()}
                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold ring-1 ring-white/10 hover:bg-white/15"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="relative mt-4 aspect-square w-full overflow-hidden rounded-3xl bg-slate-950/40 ring-1 ring-white/10">
              <div className="absolute inset-0">
                <div className="absolute left-1/2 top-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white/10" />
                <div className="absolute left-1/2 top-1/2 h-[190px] w-[190px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white/10" />
                <div className="absolute left-1/2 top-1/2 h-[110px] w-[110px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white/10" />
              </div>

              <div className="absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-2xl text-sm font-bold text-slate-950 shadow-sm ring-1 ring-white/10"
                  style={{ backgroundColor: seededColor(self?.avatarSeed ?? 'self') }}
                >
                  {initials(self?.displayName ?? 'You')}
                </div>
                <div className="mt-2 text-xs text-white/70">You</div>
              </div>

              {radarPeers.map(({ peer, x, y }) => {
                const st = statusByPeerId[peer.socketId] ?? 'available';
                const active = selectedPeerId === peer.socketId;
                return (
                  <button
                    key={peer.socketId}
                    onClick={() => connectTo(peer.socketId)}
                    className={[
                      'absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-2xl px-2.5 py-2 text-left ring-1 transition',
                      active ? 'bg-white/15 ring-emerald-400/60' : 'bg-white/5 ring-white/10 hover:bg-white/10'
                    ].join(' ')}
                    style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
                    title={peer.displayName}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-9 w-9 items-center justify-center rounded-xl text-xs font-semibold text-slate-950"
                        style={{ backgroundColor: seededColor(peer.avatarSeed) }}
                      >
                        {initials(peer.displayName)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold">{peer.displayName}</div>
                        <div className="text-[11px] text-white/60">{st}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-2">
              {peers.length === 0 ? (
                <div className="rounded-2xl bg-white/5 p-4 text-sm text-white/70 ring-1 ring-white/10">
                  {self?.roomId 
                    ? `No one else is in Room "${self.roomId}" yet.` 
                    : 'Searching for devices on the same WiFi... Type a Room ID above if discovery fails.'}
                </div>
              ) : (
                peers.map((p) => {
                  const st = statusByPeerId[p.socketId] ?? 'available';
                  const active = selectedPeerId === p.socketId;
                  return (
                    <button
                      key={p.socketId}
                      onClick={() => connectTo(p.socketId)}
                      className={[
                        'flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left ring-1 transition',
                        active ? 'bg-white/15 ring-emerald-400/60' : 'bg-white/5 ring-white/10 hover:bg-white/10'
                      ].join(' ')}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xs font-semibold text-slate-950"
                          style={{ backgroundColor: seededColor(p.avatarSeed) }}
                        >
                          {initials(p.displayName)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{p.displayName}</div>
                          <div className="truncate text-xs text-white/60">{p.socketId.slice(0, 10)}</div>
                        </div>
                      </div>
                      <div className="text-xs text-white/70">{st}</div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-3xl bg-white/5 p-4 ring-1 ring-white/10 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">Transfer</div>
                <div className="text-xs text-white/60">
                  {selectedPeer ? `Selected: ${selectedPeer.displayName}` : 'Select a peer from Discovery'}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => clientRef.current?.disconnectFromPeer(selectedPeerId)}
                  disabled={!selectedPeerId}
                  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl bg-slate-950/35 p-4 ring-1 ring-white/10">
                <div className="text-xs font-semibold text-white/80">Send</div>

                <DropZone onFiles={onPickFiles} />

                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-white/70">
                    <div className="truncate">{sendProgress.fileName || 'No file selected'}</div>
                    <div className="tabular-nums">
                      {formatBytes(sendProgress.bytesSent)} / {formatBytes(sendProgress.totalBytes)}
                    </div>
                  </div>
                  <ProgressBar value={sendProgress.bytesSent} max={sendProgress.totalBytes} />
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={sendFile}
                    disabled={!fileToSend || !selectedPeerId}
                    className="flex-1 rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-300 disabled:opacity-50"
                  >
                    Send to selected peer
                  </button>
                </div>
              </div>

              <div className="rounded-3xl bg-slate-950/35 p-4 ring-1 ring-white/10">
                <div className="text-xs font-semibold text-white/80">Receive</div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-white/70">
                    <div className="truncate">{recvProgress.fileName || 'Waiting…'}</div>
                    <div className="tabular-nums">
                      {formatBytes(recvProgress.bytesReceived)} / {formatBytes(recvProgress.totalBytes)}
                    </div>
                  </div>
                  <ProgressBar value={recvProgress.bytesReceived} max={recvProgress.totalBytes} />
                  <div className="text-[11px] text-white/60">
                    Downloads stream directly to disk to avoid memory spikes.
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-4 left-1/2 z-50 w-[min(520px,calc(100%-2rem))] -translate-x-1/2 rounded-2xl bg-black/70 px-4 py-3 text-sm text-white ring-1 ring-white/10 backdrop-blur">
          {toast}
        </div>
      ) : null}
    </div>
  );

  return container;
}

function DropZone({ onFiles }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDrag(false);
        const files = e.dataTransfer?.files;
        if (files?.length) onFiles(files);
      }}
      className={[
        'mt-3 flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed px-4 py-6 text-center transition',
        drag ? 'border-emerald-400/80 bg-emerald-400/10' : 'border-white/15 bg-white/5 hover:bg-white/10'
      ].join(' ')}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <div className="text-sm font-semibold">Drop a file here</div>
      <div className="mt-1 text-xs text-white/60">or tap to pick a file</div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
    </div>
  );
}

