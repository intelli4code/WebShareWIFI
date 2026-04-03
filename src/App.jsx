import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createWebShareClient } from './client.js';

function hashToAngleDegrees(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 360) ;
}

function seededColor(seed) {
  const angle = hashToAngleDegrees(seed);
  return `hsl(${angle}, 75%, 60%)`;
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

function ProgressBar({ value, max, color = 'bg-brand-accent' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5 border border-white/5">
      <div 
        className={`h-full rounded-full transition-all duration-300 ease-out ${color}`} 
        style={{ width: `${pct}%` }} 
      />
    </div>
  );
}

export default function App() {
  const [self, setSelf] = useState(null);
  const [peers, setPeers] = useState([]);
  const [selectedPeerId, setSelectedPeerId] = useState(null);
  const [statusByPeerId, setStatusByPeerId] = useState({});
  const [filesToSend, setFilesToSend] = useState([]);
  const [currentTransferIndex, setCurrentTransferIndex] = useState(0);
  const [isSending, setIsSending] = useState(false);
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
        clientRef.current._toastTimer = window.setTimeout(() => setToast(''), 3000);
      }
    });

    clientRef.current = client;
    client.connect();
    return () => client.destroy();
  }, []);

  const selectedPeer = useMemo(() => peers.find((p) => p.socketId === selectedPeerId) ?? null, [peers, selectedPeerId]);

  function onPickFiles(files) {
    if (!files?.length) return;
    const arr = Array.from(files);
    setFilesToSend(arr);
    setCurrentTransferIndex(0);
    setSendProgress({ bytesSent: 0, totalBytes: arr[0].size, fileName: arr[0].name });
  }

  async function connectTo(peerId) {
    setSelectedPeerId(peerId);
    await clientRef.current?.connectToPeer(peerId);
  }

  async function sendFiles() {
    if (!filesToSend.length || !selectedPeerId) {
      setToast('Pick files and choose a peer.');
      return;
    }
    
    setIsSending(true);
    let successCount = 0;
    
    for (let i = 0; i < filesToSend.length; i++) {
      setCurrentTransferIndex(i);
      const f = filesToSend[i];
      setSendProgress({ bytesSent: 0, totalBytes: f.size, fileName: f.name });
      
      try {
        await clientRef.current?.sendFile(selectedPeerId, f);
        successCount++;
      } catch (err) {
        setToast(`Transfer failed for ${f.name}`);
        break; // Stop queue on failure
      }
    }
    
    setToast(successCount === filesToSend.length ? 'All files transferred successfully!' : `Transferred ${successCount} files.`);
    setIsSending(false);
    setFilesToSend([]);
    setCurrentTransferIndex(0);
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 glass-card border-x-0 border-t-0 py-4 px-6">
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-accent/20 border border-brand-accent/30 shadow-lg shadow-brand-accent/5">
              <svg className="w-6 h-6 text-brand-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">WebShareWIFI</h1>
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${self?.socketId ? 'bg-brand-success pulse' : 'bg-red-500'}`} />
                {self?.socketId ? 'Ready for transfer' : 'Establishing secure connection...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 glass-card rounded-xl px-4 py-2 bg-brand-card/50">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white shadow-inner"
              style={{ backgroundColor: seededColor(self?.avatarSeed ?? 'self') }}
            >
              {initials(self?.displayName ?? 'You')}
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold">{self?.displayName ?? 'Guest User'}</div>
              <div className="text-[10px] text-slate-500 font-mono">{self?.socketId ? `ID: ${self.socketId.slice(0, 8)}` : 'DISCONNECTED'}</div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex-1 mx-auto max-w-7xl w-full p-6 grid gap-8 lg:grid-cols-[1fr_380px]">
        
        {/* Discovery & Peers */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Active Peers</h2>
              <p className="text-sm text-slate-400">Discover and connect with devices on your network</p>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Private Room..."
                  className="w-40 glass-card rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-accent/50 transition-all"
                  onBlur={(e) => clientRef.current?.reannounce(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && clientRef.current?.reannounce(e.target.value)}
                  defaultValue={self?.roomId || ''}
                />
              </div>
              <button 
                onClick={() => clientRef.current?.reannounce()}
                className="btn-secondary flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                <span className="hidden sm:inline">Scan</span>
              </button>
            </div>
          </div>

          {peers.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center border-dashed">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800/50 mb-4">
                <svg className="w-8 h-8 text-slate-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-slate-300">Searching for peers...</h3>
              <p className="text-sm text-slate-500 mt-2 max-w-sm mx-auto">
                No devices found on the same network. Ensure others have this page open or join a <span className="text-brand-accent">Room ID</span> together.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {peers.map((p) => {
                const st = statusByPeerId[p.socketId] ?? 'available';
                const active = selectedPeerId === p.socketId;
                return (
                  <button
                    key={p.socketId}
                    onClick={() => connectTo(p.socketId)}
                    className={`group relative text-left p-4 rounded-2xl border transition-all duration-300 ${
                      active 
                        ? 'glass-card border-brand-accent/50 bg-brand-accent/5 ring-1 ring-brand-accent/20 shadow-lg shadow-brand-accent/5' 
                        : 'glass-card hover:border-slate-600 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white shadow-lg shrink-0"
                        style={{ backgroundColor: seededColor(p.avatarSeed) }}
                      >
                        {initials(p.displayName)}
                      </div>
                      <div className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                        st === 'connected' ? 'bg-brand-success/10 text-brand-success' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {st}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-white group-hover:text-brand-accent transition-colors truncate">
                        {p.displayName}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate uppercase">
                        {p.socketId.slice(0, 12)}
                      </div>
                    </div>
                    {active && (
                      <div className="absolute top-2 right-2 flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-accent"></span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Transfer Sidebar */}
        <aside className="space-y-6">
          <div className="glass-card rounded-2xl p-6 ring-1 ring-white/5">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 mb-6 flex items-center gap-2">
              <svg className="w-4 h-4 text-brand-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Fast Transfer
            </h3>

            <div className="space-y-6">
              {/* DropZone */}
              <div className="relative group">
                <DropZone onFiles={onPickFiles} />
                {filesToSend.length > 0 && (
                  <div className="mt-4 p-3 rounded-xl bg-white/5 border border-brand-border animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-brand-accent/10 border border-brand-accent/20">
                         <svg className="w-6 h-6 text-brand-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-white truncate">
                          {filesToSend.length === 1 ? filesToSend[0].name : `${filesToSend.length} files staged`}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {formatBytes(filesToSend.reduce((acc, f) => acc + f.size, 0))} Total
                        </div>
                      </div>
                      {filesToSend.length > 1 && (
                        <div className="text-[10px] font-bold text-brand-accent bg-brand-accent/10 border border-brand-accent/20 px-2 py-0.5 rounded-md">
                          {currentTransferIndex + 1} / {filesToSend.length}
                        </div>
                      )}
                    </div>
                    
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span className="truncate max-w-[200px] pr-2">Sending: {sendProgress.fileName || 'Idle'}</span>
                        <span className="tabular-nums font-medium">{sendProgress.totalBytes > 0 ? Math.round((sendProgress.bytesSent / sendProgress.totalBytes) * 100) : 0}%</span>
                      </div>
                      <ProgressBar value={sendProgress.bytesSent} max={sendProgress.totalBytes} />
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={sendFiles}
                        disabled={isSending || !selectedPeerId}
                        className="btn-primary w-full shadow-lg shadow-brand-accent/10 py-3 flex justify-center items-center gap-2"
                      >
                        {isSending ? (
                          <>
                            <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                            Transmitting...
                          </>
                        ) : 'Transmit Queue'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Receive Section */}
              <div className="pt-6 border-t border-brand-border">
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-4">Live Reception</h4>
                {recvProgress.totalBytes > 0 ? (
                  <div className="p-3 rounded-xl bg-slate-900 border border-brand-border">
                     <div className="flex items-center gap-3 mb-3">
                      <div className="h-10 w-10 flex items-center justify-center rounded-lg bg-brand-success/10 border border-brand-success/20">
                         <svg className="w-6 h-6 text-brand-success" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate max-w-[200px]">{recvProgress.fileName || 'Incoming...'}</div>
                        <div className="text-[10px] text-slate-500">{formatBytes(recvProgress.bytesReceived)} / {formatBytes(recvProgress.totalBytes)}</div>
                      </div>
                    </div>
                    
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px] text-slate-400">
                        <span>Streaming to disk</span>
                        <span className="tabular-nums font-medium text-brand-success">{Math.round((recvProgress.bytesReceived / (recvProgress.totalBytes || 1)) * 100)}%</span>
                      </div>
                      <ProgressBar value={recvProgress.bytesReceived} max={recvProgress.totalBytes} color="bg-brand-success" />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-4 text-center">
                    <div className="w-8 h-8 rounded-full border-2 border-slate-800 border-t-brand-accent animate-spin mb-4" />
                    <p className="text-[11px] text-slate-500 px-4">Waiting for incoming transfers. Receiver stream is active.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="px-2">
            <button
               onClick={() => clientRef.current?.disconnectFromPeer(selectedPeerId)}
               disabled={!selectedPeerId}
               className="text-xs text-slate-500 hover:text-red-400 flex items-center gap-2 transition-colors disabled:opacity-30"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Terminate active peer session
            </button>
          </div>
        </aside>
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className="px-6 py-3 rounded-2xl glass-card bg-slate-900 shadow-2xl border-brand-accent/20 flex items-center gap-3">
             <div className="h-2 w-2 rounded-full bg-brand-accent animate-pulse" />
             <span className="text-sm font-medium text-slate-200">{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DropZone({ onFiles }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDrag(true); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDrag(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDrag(false); }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation(); setDrag(false);
        const files = e.dataTransfer?.files;
        if (files?.length) onFiles(files);
      }}
      className={`relative h-48 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer ${
        drag ? 'border-brand-accent bg-brand-accent/5 scale-[0.99]' : 'border-slate-800 bg-white/[0.02] hover:bg-white/[0.04] hover:border-slate-700'
      }`}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <div className="w-12 h-12 rounded-full bg-slate-800/50 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
        <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
        </svg>
      </div>
      <div className="text-sm font-semibold text-slate-200">Stage Files</div>
      <div className="text-[11px] text-slate-500 mt-1">Drop files here or click to browse</div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
    </div>
  );
}

