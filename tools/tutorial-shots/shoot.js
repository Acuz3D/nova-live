// Opens the Nova Live window in a test copy with a made-up demo library and
// saves labelled screenshots for the tutorial (docs/tutorial).
//
// It never runs main.js: no tray, no wallpaper, no single-instance lock, and
// it never reads or writes the real Nova Live library or settings. The page
// gets demo-preload.js instead of the real preload.js.
//
//   node_modules\electron\dist\electron.exe tools\tutorial-shots\shoot.js [shot names]
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');

// a throwaway profile, so nothing lands in AppData
app.setPath('userData', path.join(os.tmpdir(), 'nova-live-tutorial-shots'));

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'tutorial');

// Pass shot names to take only those, e.g. "5-library".
const ONLY = process.argv.filter((a) => /^\d+-[a-z-]+$/.test(a));
const wanted = (shot) => !ONLY.length || ONLY.includes(shot.name);

// ---- labels drawn on top of the page (same style as Nova Grid's shots) ----
const PAGE_HELPERS = `
window.__tut = {
  clear() { document.getElementById('tut-overlay')?.remove(); },
  els(sel, i) {
    const list = [];
    for (const s of [].concat(sel)) {
      const all = [...document.querySelectorAll(s)].filter((e) => e.offsetParent || e.getClientRects().length);
      if (i != null) all[i] && list.push(all[i]); else list.push(...all);
    }
    return list;
  },
  rect(sel, i, pad = 6) {
    const rs = this.els(sel, i).map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.left)) - pad, y = Math.min(...rs.map((r) => r.top)) - pad;
    return { x, y, w: Math.max(...rs.map((r) => r.right)) + pad - x, h: Math.max(...rs.map((r) => r.bottom)) + pad - y };
  },
  draw(marks) {
    this.clear();
    const o = document.createElement('div');
    o.id = 'tut-overlay';
    o.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;font-family:Segoe UI,sans-serif';
    document.body.appendChild(o);
    const missing = [];
    marks.forEach((m, n) => {
      const r = this.rect(m.sel, m.i, m.pad ?? 6);
      if (!r) return missing.push(String(m.sel));
      const box = document.createElement('div');
      box.style.cssText = 'position:absolute;border:3px solid #22d3ee;border-radius:9px;box-shadow:0 0 0 3px rgba(34,211,238,.25),0 0 22px rgba(34,211,238,.55)';
      Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      o.appendChild(box);
      const tag = document.createElement('div');
      tag.style.cssText = 'position:absolute;display:flex;align-items:center;gap:10px;padding:7px 14px 7px 7px;background:rgba(8,10,14,.94);border:2px solid #22d3ee;border-radius:999px;color:#fff;font-size:19px;font-weight:600;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.6)';
      tag.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#22d3ee;color:#000;font-weight:800;font-size:17px">' + (n + 1) + '</span>';
      tag.append(m.label);
      o.appendChild(tag);
      const tw = tag.offsetWidth, th = tag.offsetHeight, gap = 12;
      let x, y;
      const pos = m.pos || 'below';
      if (pos === 'below') { x = r.x; y = r.y + r.h + gap; }
      if (pos === 'above') { x = r.x; y = r.y - th - gap; }
      if (pos === 'right') { x = r.x + r.w + gap; y = r.y + r.h / 2 - th / 2; }
      if (pos === 'left') { x = r.x - tw - gap; y = r.y + r.h / 2 - th / 2; }
      if (pos === 'inside') { x = r.x + r.w / 2 - tw / 2; y = r.y + r.h / 2 - th / 2; }
      if (m.dx) x += m.dx; if (m.dy) y += m.dy;
      x = Math.max(8, Math.min(innerWidth - tw - 8, x));
      y = Math.max(8, Math.min(innerHeight - th - 8, y));
      Object.assign(tag.style, { left: x + 'px', top: y + 'px' });
      const cx = x + tw / 2, cy = y + th / 2;
      const px = Math.max(r.x, Math.min(r.x + r.w, cx)), py = Math.max(r.y, Math.min(r.y + r.h, cy));
      if (Math.hypot(cx - px, cy - py) > th) {
        const line = document.createElement('div');
        const len = Math.hypot(cx - px, cy - py), ang = Math.atan2(cy - py, cx - px);
        line.style.cssText = 'position:absolute;height:3px;background:#22d3ee;transform-origin:0 50%;box-shadow:0 0 8px rgba(34,211,238,.7);border-radius:2px';
        Object.assign(line.style, { left: px + 'px', top: py - 1.5 + 'px', width: len + 'px', transform: 'rotate(' + ang + 'rad)' });
        o.insertBefore(line, tag);
        const dot = document.createElement('div');
        dot.style.cssText = 'position:absolute;width:10px;height:10px;border-radius:50%;background:#22d3ee';
        Object.assign(dot.style, { left: px - 5 + 'px', top: py - 5 + 'px' });
        o.insertBefore(dot, tag);
      }
    });
    return missing;
  },
  // centre of an element, for moving the mouse over it
  centre(sel, i) {
    const r = this.rect(sel, i, 0);
    return r && { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
  },
  reset() {
    document.getElementById('settings-panel').classList.remove('open');
    document.getElementById('settings-btn').classList.remove('open');
    document.getElementById('link').value = '';
    document.getElementById('main').scrollTop = 0;
    document.activeElement?.blur();
  },
};`;

const SHOTS = [
  {
    name: '2-set-wallpaper',
    setup: `__tut.reset(); const l = document.getElementById('link'); l.value = 'https://www.youtube.com/watch?v=NovaLiveDemo'; l.focus(); l.setSelectionRange(l.value.length, l.value.length);`,
    marks: [
      { sel: '.link-box', label: 'Paste a video, picture or web page link', pos: 'above', dx: 650, dy: -4, pad: 4 },
      { sel: '#add-btn', label: 'Set as wallpaper', pos: 'below', dx: -40, dy: 120, pad: 4 },
      { sel: '#browse-btn', label: 'Or browse for a file (or drop one on the window)', pos: 'below', dx: -330, dy: 220, pad: 4 },
    ],
  },
  {
    name: '3-controls',
    setup: `__tut.reset(); document.getElementById('main').scrollTop = 120;`,
    marks: [
      { sel: ['#play-btn', '#next-btn'], label: 'Pause / play · Next', pos: 'below', dx: -60, dy: 150, pad: 5 },
      { sel: '.sound', label: 'Sound and volume', pos: 'below', dx: -20, dy: 230, pad: 5 },
      { sel: '#fit', label: 'Fill · Fit · Stretch', pos: 'below', dx: 40, dy: 150, pad: 5 },
      { sel: '#off-btn', label: 'Turn off (back to your normal wallpaper)', pos: 'below', dx: -380, dy: 230, pad: 5 },
    ],
  },
  {
    name: '4-auto-next',
    // box just the "next in 7 min" part of the line under the title
    setup: `__tut.reset(); document.getElementById('main').scrollTop = 120; const s = document.getElementById('now-sub'); const t = s.textContent; const k = t.lastIndexOf(' · '); s.innerHTML = ''; s.append(t.slice(0, k + 3)); const n = document.createElement('span'); n.id = 'tut-next'; n.textContent = t.slice(k + 3); s.append(n);`,
    marks: [
      { sel: '.auto-next', label: 'Auto next: pick how often', pos: 'below', dx: -160, dy: 150, pad: 5 },
      { sel: '#shuffle-btn', label: 'Shuffle (on)', pos: 'below', dx: 30, dy: 240, pad: 5 },
      { sel: '#tut-next', label: 'Time until the next one', pos: 'right', dx: 120, dy: -60, pad: 4 },
    ],
  },
  {
    name: '5-library',
    setup: `__tut.reset(); const m = document.getElementById('main'); m.scrollTop = m.scrollHeight;`,
    hover: { sel: '.card', i: 1 },
    marks: [
      { sel: '.card:nth-child(2) [data-act="rename"]', label: 'Rename', pos: 'above', dx: -150, dy: -40, pad: 3 },
      { sel: '.card:nth-child(2) [data-act="source"]', label: 'Open the original link', pos: 'above', dx: 0, dy: -100, pad: 3 },
      { sel: '.card:nth-child(2) [data-act="remove"]', label: 'Remove (click twice)', pos: 'right', dx: 60, dy: -60, pad: 3 },
      { sel: '#import-btn', label: 'Bring in videos from Nova Grid', pos: 'below', dx: -140, dy: 60, pad: 4 },
    ],
  },
  {
    name: '6-settings',
    setup: `__tut.reset(); document.getElementById('settings-btn').click();`,
    marks: [
      { sel: 'label.toggle:has(#opt-start)', label: 'Start with Windows', pos: 'left', dx: -40, pad: 2 },
      { sel: 'label.toggle:has(#opt-fullscreen)', label: 'Pause for games and full-screen apps', pos: 'left', dx: -40, dy: 40, pad: 2 },
      { sel: 'label.row:has(#opt-quality)', label: 'Download quality', pos: 'left', dx: -40, dy: 70, pad: 2 },
      { sel: ['label:has(#opt-see)', 'label:has(#opt-blur)'], label: 'Look: see-through and glass blur', pos: 'left', dx: -40, dy: 40, pad: 2 },
    ],
  },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    show: false,
    backgroundColor: '#0b0b0c',
    title: 'Nova Live (tutorial shots)',
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'demo-preload.js') },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.showInactive();
  const wc = win.webContents;
  await wait(2000);
  await wc.executeJavaScript(PAGE_HELPERS + ';0');

  for (const shot of SHOTS.filter(wanted)) {
    await wc.executeJavaScript(`__tut.clear(); ${shot.setup}; 0`);
    await wait(700);
    if (shot.hover) {
      const p = await wc.executeJavaScript(`__tut.centre(${JSON.stringify(shot.hover.sel)}, ${shot.hover.i})`);
      for (let k = 0; k < 3; k++) {
        wc.sendInputEvent({ type: 'mouseMove', x: p.x - 2 + k, y: p.y });
        await wait(80);
      }
    } else {
      wc.sendInputEvent({ type: 'mouseMove', x: 2, y: 790 });
    }
    await wait(600);
    const missing = await wc.executeJavaScript(`__tut.draw(${JSON.stringify(shot.marks)})`);
    if (missing.length) console.log('MISSING in', shot.name, missing);
    await wait(400);
    let img;
    for (let t = 0; t < 4 && !img; t++) {
      try { img = await wc.capturePage(); } catch (e) { console.log('retry', shot.name, e.message); await wait(1000); }
    }
    fs.writeFileSync(path.join(OUT, shot.name + '.png'), img.toPNG());
    console.log('saved', shot.name, img.getSize());
  }
  app.exit(0);
});
