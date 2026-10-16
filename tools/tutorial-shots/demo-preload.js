// Stand-in for preload.js: the same window.nova API, but it only ever returns
// a made-up demo library. Nothing here touches the real app, its settings or
// the desktop wallpaper.
const { contextBridge } = require('electron');

// ---- demo thumbnails, drawn on a canvas ----
function scene(kind) {
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 270;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  let seed = kind.length * 977;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const sky = (stops) => {
    const gr = g.createLinearGradient(0, 0, 0, H);
    stops.forEach(([p, col]) => gr.addColorStop(p, col));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  };
  if (kind === 'city') {
    sky([[0, '#140a2e'], [0.6, '#3b1a5c'], [1, '#e2457a']]);
    for (let x = 0; x < W; ) {
      const bw = 30 + rnd() * 40, bh = 80 + rnd() * 150;
      g.fillStyle = '#0d0a1c';
      g.fillRect(x, H - bh, bw - 4, bh);
      for (let wy = H - bh + 8; wy < H - 6; wy += 12)
        for (let wx = x + 5; wx < x + bw - 10; wx += 9)
          if (rnd() > 0.55) {
            g.fillStyle = rnd() > 0.5 ? '#22d3ee' : '#f472b6';
            g.fillRect(wx, wy, 4, 5);
          }
      x += bw;
    }
    g.strokeStyle = 'rgba(180,220,255,.35)';
    g.lineWidth = 1;
    for (let i = 0; i < 140; i++) {
      const x = rnd() * W, y = rnd() * H;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - 4, y + 16); g.stroke();
    }
  } else if (kind === 'ocean') {
    sky([[0, '#2a1f5c'], [0.45, '#f08a5d'], [0.58, '#ffcf8a'], [0.6, '#1d3d6e'], [1, '#0b1a33']]);
    g.fillStyle = '#ffe2a8';
    g.beginPath(); g.arc(W * 0.62, H * 0.58, 34, Math.PI, 0); g.fill();
    for (let i = 0; i < 9; i++) {
      const y = H * 0.62 + i * 12;
      g.strokeStyle = `rgba(255,200,150,${0.5 - i * 0.05})`;
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x <= W; x += 8) g.lineTo(x, y + Math.sin(x / 22 + i) * 3);
      g.stroke();
    }
  } else if (kind === 'stars') {
    sky([[0, '#02030a'], [1, '#0b1030']]);
    for (let i = 0; i < 320; i++) {
      const r = rnd() * 1.6 + 0.3;
      g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`;
      g.beginPath(); g.arc(rnd() * W, rnd() * H, r, 0, 7); g.fill();
    }
    const neb = g.createRadialGradient(W * 0.7, H * 0.35, 5, W * 0.7, H * 0.35, 160);
    neb.addColorStop(0, 'rgba(120,80,255,.45)');
    neb.addColorStop(1, 'rgba(120,80,255,0)');
    g.fillStyle = neb;
    g.fillRect(0, 0, W, H);
  } else if (kind === 'room') {
    sky([[0, '#3a2a3f'], [1, '#1c1420']]);
    g.fillStyle = '#16213f'; g.fillRect(250, 40, 170, 120);
    g.fillStyle = '#f5e6b0'; g.beginPath(); g.arc(380, 70, 12, 0, 7); g.fill();
    g.strokeStyle = '#2b1f2e'; g.lineWidth = 8; g.strokeRect(250, 40, 170, 120);
    g.beginPath(); g.moveTo(335, 40); g.lineTo(335, 160); g.stroke();
    g.fillStyle = '#5a3d33'; g.fillRect(40, 190, 400, 14);
    g.fillStyle = '#2e2433'; g.fillRect(110, 140, 110, 50);
    g.fillStyle = '#7dd3fc'; g.fillRect(116, 146, 98, 38);
    const lamp = g.createRadialGradient(70, 150, 2, 70, 150, 120);
    lamp.addColorStop(0, 'rgba(255,190,110,.6)');
    lamp.addColorStop(1, 'rgba(255,190,110,0)');
    g.fillStyle = lamp; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8a25a'; g.beginPath(); g.moveTo(55, 150); g.lineTo(85, 150); g.lineTo(78, 130); g.lineTo(62, 130); g.fill();
    g.fillStyle = '#3b6b4a'; g.beginPath(); g.arc(400, 178, 14, 0, 7); g.fill();
  } else if (kind === 'aurora') {
    sky([[0, '#030a18'], [1, '#0a1f2e']]);
    for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(rnd() * W, rnd() * H * 0.6, 1.2, 1.2); }
    for (let b = 0; b < 3; b++) {
      g.strokeStyle = ['rgba(52,211,153,.55)', 'rgba(34,211,238,.4)', 'rgba(167,139,250,.35)'][b];
      g.lineWidth = 26 - b * 6;
      g.beginPath();
      for (let x = -10; x <= W + 10; x += 10) g.lineTo(x, 70 + b * 22 + Math.sin(x / 60 + b) * 26);
      g.stroke();
    }
    g.fillStyle = '#050b12';
    g.beginPath(); g.moveTo(0, H);
    [[0, 200], [90, 150], [160, 190], [250, 130], [340, 185], [420, 155], [480, 180], [480, H]].forEach(([x, y]) => g.lineTo(x, y));
    g.fill();
  } else if (kind === 'mountain') {
    sky([[0, '#7cc4f0'], [0.6, '#fbd38d'], [1, '#f6ad55']]);
    g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(150, 170, 30, 0, 7); g.fill();
    g.fillStyle = '#5b6b8c';
    g.beginPath(); g.moveTo(0, H); [[0, 190], [120, 110], [210, 170], [320, 80], [480, 190], [480, H]].forEach(([x, y]) => g.lineTo(x, y)); g.fill();
    g.fillStyle = '#34405a';
    g.beginPath(); g.moveTo(0, H); [[0, 230], [140, 180], [260, 225], [380, 170], [480, 220], [480, H]].forEach(([x, y]) => g.lineTo(x, y)); g.fill();
  }
  return c.toDataURL('image/jpeg', 0.85);
}

const DAY = 86400e3;
const now = Date.now();
let state = null;
function demoState() {
  const lib = [
    ['a1', 'Neon city rain', 'video', 'city', 'https://www.youtube.com/watch?v=NovaLiveDemo1', 1],
    ['a2', 'Ocean waves at dusk', 'video', 'ocean', 'https://www.youtube.com/watch?v=NovaLiveDemo2', 3],
    ['a3', 'Starfield drift', 'video', 'stars', 'https://vimeo.com/novalivedemo', 5],
    ['a4', 'Lo-fi room', 'video', 'room', 'https://www.youtube.com/watch?v=NovaLiveDemo3', 8],
    ['a5', 'Aurora timelapse', 'video', 'aurora', 'https://www.youtube.com/watch?v=NovaLiveDemo4', 12],
    ['a6', 'Mountain sunrise', 'image', 'mountain', 'mountain-sunrise.jpg', 15],
  ].map(([id, title, kind, art, source, ago]) => ({ id, title, kind, source, added: now - ago * DAY, thumbUrl: scene(art) }));
  return {
    library: lib,
    current: 'a1',
    paused: false,
    autoPaused: false,
    muted: false,
    volume: 45,
    fit: 'cover',
    quality: 1080,
    startWithWindows: true,
    pauseOnFullscreen: true,
    autoNext: 10,
    shuffle: true,
    nextAt: now + 7 * 60000 - 5000,
    see: 0.6,
    blur: 14,
    busy: false,
    novaGrid: 3,
    downloader: true,
    version: '1.0.0',
  };
}
const get = () => (state ||= demoState());
const listeners = [];
const done = () => Promise.resolve(get());

contextBridge.exposeInMainWorld('nova', {
  state: done,
  addText: () => Promise.resolve(null),
  addFiles: () => Promise.resolve(null),
  browse: () => Promise.resolve(null),
  importNovaGrid: () => Promise.resolve(null),
  next: done,
  set: done,
  remove: done,
  rename: done,
  settings: (change) => {
    Object.assign(get(), change);
    return done();
  },
  openLibrary: () => {},
  openSource: () => {},
  minimise: () => {},
  close: () => {},
  onState: (cb) => listeners.push(cb),
  onProgress: () => {},
});
