// Makes icon.png, icon.ico and the app background from the artwork in art/.
// Run with: npm run icon
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dataUrl = (file) => 'data:image/png;base64,' + fs.readFileSync(path.join(root, file)).toString('base64');

// rounded corners like the other Nova icons
const draw = `(async (src, sizes) => {
  const img = new Image(); img.src = src; await img.decode();
  const out = {};
  for (const s of sizes) {
    const c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    const r = s * 0.12;
    g.beginPath(); g.roundRect(0, 0, s, s, r); g.clip();
    g.drawImage(img, 0, 0, s, s);
    out[s] = c.toDataURL('image/png');
  }
  return out;
})`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<body></body>');
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const pngs = await win.webContents.executeJavaScript(`${draw}(${JSON.stringify(dataUrl('art/icon-art.png'))}, ${JSON.stringify(sizes)})`);
  const buf = (s) => Buffer.from(pngs[s].split(',')[1], 'base64');
  fs.writeFileSync(path.join(root, 'icon.png'), buf(512));
  fs.writeFileSync(path.join(root, 'tray.png'), buf(32));

  // .ico holding PNGs, one per size up to 256
  const icoSizes = sizes.filter((s) => s <= 256);
  const header = Buffer.alloc(6 + 16 * icoSizes.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
  let offset = header.length;
  const bodies = icoSizes.map((s, i) => {
    const b = buf(s);
    const e = 6 + 16 * i;
    header.writeUInt8(s === 256 ? 0 : s, e); header.writeUInt8(s === 256 ? 0 : s, e + 1);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(b.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += b.length;
    return b;
  });
  fs.writeFileSync(path.join(root, 'icon.ico'), Buffer.concat([header, ...bodies]));

  // the app's background art, smaller to load
  const bg = nativeImage.createFromPath(path.join(root, 'art/background.png'));
  fs.writeFileSync(path.join(root, 'renderer/background.jpg'), bg.toJPEG(90));

  // GitHub banner: the art with "— Nova ✦ Live —" across it, as on the icon
  const banner = await win.webContents.executeJavaScript(`(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = 1600; c.height = 560;
    const g = c.getContext('2d');
    const s = Math.max(c.width / img.width, c.height / img.height);
    g.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) * 0.3, img.width * s, img.height * s);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, c.width, c.height);
    const y = c.height / 2;
    g.font = '300 118px "Sitka Banner", "Sitka Display", Georgia, serif';
    g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.shadowColor = 'rgba(255,255,255,0.75)'; g.shadowBlur = 26;
    const word = (t, x, align) => { g.textAlign = align; g.letterSpacing = '10px'; g.fillText(t, x, y); };
    word('Nova', c.width / 2 - 52, 'right');
    word('Live', c.width / 2 + 52, 'left');
    // four-point star between the words
    const star = (cx, cy, r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 - Math.PI / 2; const rr = i % 2 ? r * 0.18 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); g.fill(); };
    star(c.width / 2, y + 4, 34);
    // hairlines out to the edges, brightest near the words
    const line = (x1, x2) => { const gr = g.createLinearGradient(x1, 0, x2, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)'); g.fillStyle = gr; g.fillRect(Math.min(x1, x2), y + 3, Math.abs(x2 - x1), 2); };
    line(60, c.width / 2 - 52 - g.measureText('Nova').width - 30);
    line(c.width - 60, c.width / 2 + 52 + g.measureText('Live').width + 30);
    return c.toDataURL('image/jpeg', 0.9);
  })(${JSON.stringify('data:image/png;base64,' + fs.readFileSync(path.join(root, 'art/background.png')).toString('base64'))})`);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/banner.jpg'), Buffer.from(banner.split(',')[1], 'base64'));
  console.log('done');
  app.quit();
});
