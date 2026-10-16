const { app, BrowserWindow, ipcMain, dialog, shell, screen, Tray, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { StringDecoder } = require('string_decoder');
const desktop = require('./desktop');

// The wallpaper sits under the desktop icons, which cover the whole screen, so
// Chromium would think it is hidden and stop drawing it.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.exit(0);

const startHidden = process.argv.includes('--hidden');
let control = null; // the Nova Live window
let tray = null;
let walls = []; // one wallpaper window per screen: { win, display, primary, page, state }
let quitting = false;
let rebuilding = false;
let autoPaused = false; // a game or full-screen app is open
let busy = false;

// ---------- saved settings and the library ----------

const dataDir = () => app.getPath('userData');
const libraryDir = () => path.join(dataDir(), 'library');
const thumbsDir = () => path.join(dataDir(), 'thumbs');
const configFile = () => path.join(dataDir(), 'config.json');

const DEFAULTS = {
  current: null, // id of the library item on the desktop
  library: [], // newest first: { id, title, kind: video|image|web, file?, url?, referrer?, source, thumb?, added }
  paused: false,
  muted: true,
  volume: 40,
  fit: 'cover',
  quality: 1080,
  startWithWindows: false,
  pauseOnFullscreen: true,
  autoNext: 0, // move on to the next wallpaper: 0 = never, 'end' = when a video ends, or every N minutes
  shuffle: false,
  see: 0.6, // how see-through the panels are
  blur: 14,
  trayTipShown: false,
};
let config = { ...DEFAULTS };

function loadConfig() {
  try {
    // some editors start the file with an invisible byte-order mark
    config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configFile(), 'utf8').replace(/^﻿/, '')) };
  } catch {
    config = { ...DEFAULTS };
    // keep a copy of a file that couldn't be read, rather than saving over the library
    if (fs.existsSync(configFile())) fs.copyFileSync(configFile(), path.join(dataDir(), `config-unreadable-${Date.now()}.json`));
  }
  // drop items whose file has gone
  config.library = config.library.filter((i) => i.kind === 'web' || fs.existsSync(path.join(libraryDir(), i.file)));
  if (!config.library.some((i) => i.id === config.current)) config.current = null;
}

function saveConfig() {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

const currentItem = () => config.library.find((i) => i.id === config.current) || null;

function publicState() {
  const withUrls = (i) => ({
    ...i,
    thumbUrl: i.thumb ? `${pathToFileURL(path.join(thumbsDir(), i.thumb)).href}?v=${i.thumbAt || 0}` : null,
  });
  return {
    library: config.library.map(withUrls),
    current: config.current,
    paused: config.paused,
    autoPaused,
    muted: config.muted,
    volume: config.volume,
    fit: config.fit,
    quality: config.quality,
    startWithWindows: config.startWithWindows,
    pauseOnFullscreen: config.pauseOnFullscreen,
    autoNext: config.autoNext,
    shuffle: config.shuffle,
    nextAt,
    see: config.see,
    blur: config.blur,
    busy,
    novaGrid: novaGridVideos().length,
    downloader: !!findTool('yt-dlp.exe'),
    version: app.getVersion(),
  };
}

function broadcast() {
  if (control && !control.isDestroyed()) control.webContents.send('state', publicState());
  updateTray();
}

const progress = (text, pct = null) => {
  if (control && !control.isDestroyed()) control.webContents.send('progress', { text, pct });
};

// ---------- finding yt-dlp and ffmpeg (as in Nova Grid) ----------

// winget installs them under its Packages folder, which may not be on PATH yet.
const toolCache = {};
function findTool(exe) {
  if (exe in toolCache) return toolCache[exe];
  const found = (() => {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      const full = path.join(dir, exe);
      if (fs.existsSync(full)) return full;
    }
    const packages = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
    const search = (dir, depth) => {
      if (depth > 4 || !fs.existsSync(dir)) return null;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === exe) return full;
        if (entry.isDirectory()) {
          const hit = search(full, depth + 1);
          if (hit) return hit;
        }
      }
      return null;
    };
    return search(packages, 0);
  })();
  if (found) toolCache[exe] = found;
  return found;
}

const slug = (title) =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '') || 'wallpaper';

// "clip.mp4" -> "clip (2).mp4" if that name is already taken
function freeName(file) {
  const { name, ext } = path.parse(file);
  let candidate = file;
  for (let n = 2; fs.existsSync(path.join(libraryDir(), candidate)); n++) candidate = `${name} (${n})${ext}`;
  return candidate;
}

// ---------- adding wallpapers ----------

const VIDEO_TYPES = ['mp4', 'webm', 'm4v', 'mov', 'ogv'];
const IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif'];
const PAGE_TYPES = ['html', 'htm'];
const kindOfFile = (file) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (VIDEO_TYPES.includes(ext)) return 'video';
  if (IMAGE_TYPES.includes(ext)) return 'image';
  if (PAGE_TYPES.includes(ext)) return 'web';
  return null;
};

// YouTube's best picture is often a separate stream from the sound; ffmpeg joins
// them. H.264 is preferred up to 1080p because graphics cards play it for free;
// above that YouTube only offers VP9 and AV1, and VP9 is the lighter of the two.
function formatFor(quality, hasFfmpeg) {
  const q = Number(quality) || 1080;
  if (!hasFfmpeg) return `b[height<=${q}]/b`;
  const upTo1080 = `bv*[height<=${Math.min(q, 1080)}][vcodec^=avc1]+ba[ext=m4a]`;
  const rest = `bv*[height<=${q}]+ba/b[height<=${q}]/b`;
  if (q <= 1080) return `${upTo1080}/${rest}`;
  return `bv*[height<=${q}][height>1080][vcodec~='^vp0?9']+ba/${upTo1080}/${rest}`;
}

function runYtDlp(list, onProgress) {
  return new Promise((resolve) => {
    const ytdlp = findTool('yt-dlp.exe');
    const proc = spawn(ytdlp, list, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } });
    let out = '';
    let err = '';
    let stage = 0;
    // YouTube sometimes stops sending part-way without closing the connection;
    // if nothing moves for a while, stop and let the retry carry on from there.
    let quiet = 0;
    const watchdog = setInterval(() => {
      if (++quiet >= 45) {
        err += '\nERROR: the download stopped moving';
        proc.kill();
      }
    }, 1000);
    proc.on('close', () => clearInterval(watchdog));
    const decoder = new StringDecoder('utf8'); // keeps letters split across chunks whole
    proc.stdout.on('data', (chunk) => {
      const text = decoder.write(chunk);
      quiet = 0;
      out += text;
      if (/\[download\] Destination:/.test(text)) stage++;
      const pct = /\[download\]\s+([\d.]+)%/.exec(text);
      if (pct) onProgress(Number(pct[1]), stage);
      if (/\[Merger\]/.test(text)) onProgress(null, -1);
    });
    proc.stderr.on('data', (chunk) => (err += chunk.toString('utf8')));
    proc.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    proc.on('close', (code) => resolve({ code, out, err }));
  });
}

async function downloadWithYtDlp(url) {
  const ytdlp = findTool('yt-dlp.exe');
  if (!ytdlp) return { error: 'The video downloader (yt-dlp) is not installed. Install it with: winget install yt-dlp' };
  const ffmpeg = findTool('ffmpeg.exe');
  const node = findTool('node.exe');
  fs.mkdirSync(libraryDir(), { recursive: true });

  const list = [
    // without this, titles lose any letters outside English (Korean, Japanese, ...)
    '--encoding', 'utf-8',
    '--no-playlist', '--newline', '--progress', '--retries', '10', '--fragment-retries', '10',
    // smaller pieces dodge YouTube slowing long downloads to a crawl
    '--http-chunk-size', '10M',
    '--match-filter', '!is_live',
    '-f', formatFor(config.quality, !!ffmpeg),
    '--merge-output-format', 'mp4',
    '-o', path.join(libraryDir(), 'download-%(id)s.%(ext)s'),
    '--print', 'after_move:%(title)s\t%(filepath)s',
    ...(ffmpeg ? ['--ffmpeg-location', path.dirname(ffmpeg)] : []),
    ...(node ? ['--js-runtimes', `node:${node}`] : []),
    url,
  ];
  const onProgress = (pct, stage) => {
    if (stage === -1) return progress('Joining picture and sound…', 100);
    progress(stage > 1 ? `Downloading the sound… ${Math.round(pct)}%` : `Downloading… ${Math.round(pct)}%`, pct);
  };

  // YouTube sometimes cuts a download off part-way; yt-dlp resumes on a retry.
  let result;
  for (let attempt = 0; attempt < 4; attempt++) {
    progress(attempt ? 'The download stopped, trying again…' : 'Finding the video…');
    result = await runYtDlp(list, onProgress);
    if (result.code === 0 || /Unsupported URL/i.test(result.err)) break;
  }
  if (/does not pass filter/i.test(result.out)) return { live: true };
  if (/Unsupported URL/i.test(result.err)) return { unsupported: true };
  const line = result.out.split(/\r?\n/).reverse().find((l) => l.includes('\t'));
  if (result.code !== 0 || !line) {
    const reason = (result.err.match(/ERROR: (.*)/) || [])[1] || 'the download failed';
    return { error: `Couldn't download that link: ${reason.replace(/^\[[^\]]+\]\s*/, '').slice(0, 200)}` };
  }
  const [title, downloaded] = line.split('\t');
  const file = freeName(slug(title) + path.extname(downloaded));
  fs.renameSync(downloaded, path.join(libraryDir(), file));
  return { title, file };
}

// What a link points at, without downloading it: a picture, a video file or a page.
// Some sites refuse a HEAD request, so a normal one is tried too (and stopped
// straight away), and failing that the link's file ending is the guide.
async function contentType(url) {
  for (const method of ['HEAD', 'GET']) {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 8000);
    try {
      const res = await net.fetch(url, { method, signal: stop.signal });
      const type = res.ok ? (res.headers.get('content-type') || '').toLowerCase() : '';
      stop.abort();
      if (type) return type;
    } catch {
      // try the next way
    } finally {
      clearTimeout(timer);
    }
  }
  const ext = path.extname(new URL(url).pathname).slice(1).toLowerCase();
  return Object.keys(EXT_FOR_TYPE).find((t) => EXT_FOR_TYPE[t] === (ext === 'jpeg' ? 'jpg' : ext)) || '';
}

const EXT_FOR_TYPE = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv',
};

async function downloadDirect(url, type) {
  const ext = EXT_FOR_TYPE[type.split(';')[0].trim()];
  if (!ext) return { unsupported: true };
  let res = await net.fetch(url);
  // some sites (Wikipedia) only let programs in that say who they are
  if (res.status === 403) res = await net.fetch(url, { headers: { 'User-Agent': `NovaLive/${app.getVersion()} (https://github.com/Acuz3D/nova-live)` } });
  if (!res.ok) return { error: `Couldn't download that link (the site said ${res.status}).` };
  const total = Number(res.headers.get('content-length')) || 0;
  const name = decodeURIComponent(path.basename(new URL(url).pathname)).replace(/\.[^.]+$/, '') || 'wallpaper';
  const file = freeName(`${slug(name)}.${ext}`);
  fs.mkdirSync(libraryDir(), { recursive: true });
  const out = fs.createWriteStream(path.join(libraryDir(), file));
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(Buffer.from(value));
    got += value.length;
    if (total) progress(`Downloading… ${Math.round((got / total) * 100)}%`, (got / total) * 100);
  }
  await new Promise((r) => out.end(r));
  return { title: name, file, kind: ext in { mp4: 1, webm: 1, mov: 1, ogv: 1 } ? 'video' : 'image' };
}

function youTubeId(url) {
  const u = new URL(url);
  if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1).split('/')[0] || null;
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
  if (u.searchParams.get('v')) return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(live|shorts|embed)\/([\w-]+)/);
  return m ? m[2] : null;
}

// Live streams can't be saved, so they play straight from YouTube's own player.
function youTubeLivePage(url) {
  const id = youTubeId(url);
  if (!id) return null;
  const q = `autoplay=1&mute=1&controls=0&loop=1&playlist=${id}&playsinline=1&rel=0&iv_load_policy=3&disablekb=1`;
  return { url: `https://www.youtube.com/embed/${id}?${q}`, referrer: 'https://www.youtube.com/' };
}

async function addFromText(text) {
  text = String(text || '').trim().replace(/^"(.*)"$/, '$1');
  if (!text) return { error: 'Paste a link first.' };
  if (/^[a-z]:\\|^\\\\/i.test(text)) return addFiles([text]);

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: "That doesn't look like a link." };
  }
  if (!/^https?:$/.test(url.protocol)) return { error: 'Only web links (http or https) can be used.' };
  url = url.href;

  // already in the library? just put it back on
  const known = config.library.find((i) => i.source === url);
  if (known) {
    setCurrent(known.id);
    return { item: known, again: true };
  }

  progress('Checking the link…');
  const type = await contentType(url);
  let got;
  if (/^(image|video)\//.test(type)) got = await downloadDirect(url, type);
  else got = await downloadWithYtDlp(url);

  if (got.error) return got;
  let item;
  if (got.live) {
    const page = youTubeLivePage(url);
    if (!page) return { error: "That's a live stream, which can't be saved. Only YouTube live streams can play directly." };
    item = { kind: 'web', title: 'YouTube live stream', ...page };
  } else if (got.unsupported) {
    // not a video site: show the page itself
    item = { kind: 'web', title: new URL(url).hostname.replace(/^www\./, ''), url };
  } else {
    item = { kind: got.kind || 'video', title: got.title, file: got.file };
  }
  return addItem({ ...item, source: url });
}

function addFiles(paths) {
  let last = null;
  fs.mkdirSync(libraryDir(), { recursive: true });
  for (const src of paths) {
    if (!fs.existsSync(src) || fs.statSync(src).isDirectory()) return { error: `Couldn't find ${path.basename(src)}.` };
    const kind = kindOfFile(src);
    if (!kind) return { error: `${path.basename(src)} isn't a video, picture or web page Nova Live can show.` };
    const title = path.parse(src).name;
    if (kind === 'web') {
      // a page keeps its own pictures and scripts beside it, so it stays where it is
      last = addItem({ kind, title, url: pathToFileURL(src).href, source: src }, false);
    } else {
      const file = freeName(path.basename(src));
      progress(`Copying ${path.basename(src)}…`);
      fs.copyFileSync(src, path.join(libraryDir(), file));
      last = addItem({ kind, title, file, source: src }, false);
    }
  }
  if (last) setCurrent(last.item.id);
  return last || { error: 'Nothing to add.' };
}

function addItem(fields, makeCurrent = true) {
  const item = { id: crypto.randomUUID(), added: Date.now(), ...fields };
  config.library.unshift(item);
  saveConfig();
  makeThumb(item);
  if (makeCurrent) setCurrent(item.id);
  else broadcast();
  return { item };
}

// ---------- bringing in Nova Grid's background videos ----------

const novaGridDir = () => path.join(app.getPath('appData'), 'Nova Grid', 'backgrounds');

// the ones not brought in yet
function novaGridVideos() {
  try {
    return fs
      .readdirSync(novaGridDir())
      .filter((f) => VIDEO_TYPES.includes(path.extname(f).slice(1).toLowerCase()))
      .map((f) => path.join(novaGridDir(), f))
      .filter((src) => !config.library.some((i) => i.source === src));
  } catch {
    return [];
  }
}

// "jjk-i-will-survive" -> "Jjk I Will Survive"
const titleFromFile = (file) =>
  path.parse(file).name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()) || 'Video';

async function importNovaGrid() {
  const files = novaGridVideos();
  if (!files.length) return { error: 'There are no new Nova Grid videos to bring in.' };
  fs.mkdirSync(libraryDir(), { recursive: true });
  const added = [];
  for (const [n, src] of files.entries()) {
    progress(`Copying ${n + 1} of ${files.length} from Nova Grid…`, (n / files.length) * 100);
    const file = freeName(path.basename(src));
    await fs.promises.copyFile(src, path.join(libraryDir(), file));
    // after what's already there, in Nova Grid's order
    const item = { id: crypto.randomUUID(), added: Date.now(), kind: 'video', title: titleFromFile(src), file, source: src, from: 'Nova Grid' };
    config.library.push(item);
    added.push(item);
    saveConfig();
    broadcast();
  }
  for (const item of added) await makeThumb(item);
  if (!currentItem()) setCurrent(added[0].id);
  return { imported: added.length };
}

// ---------- thumbnails ----------

// Videos get the clearest of a few seconds' frames (so not a black fade);
// pictures and pages are taken from the screen once they show.
function makeThumb(item) {
  const ffmpeg = findTool('ffmpeg.exe');
  if (item.kind !== 'video' || !ffmpeg) return Promise.resolve();
  fs.mkdirSync(thumbsDir(), { recursive: true });
  const thumb = `${item.id}.jpg`;
  const grab = (at) =>
    new Promise((resolve) =>
      execFile(ffmpeg, ['-y', '-ss', String(at), '-i', path.join(libraryDir(), item.file), '-frames:v', '1', '-vf', 'thumbnail=60,scale=480:-2', '-q:v', '4', path.join(thumbsDir(), thumb)],
        { windowsHide: true }, (e) => resolve(!e && fs.existsSync(path.join(thumbsDir(), thumb)))),
    );
  return grab(8).then((ok) => ok || grab(0)).then((ok) => {
    if (!ok) return;
    item.thumb = thumb;
    item.thumbAt = Date.now();
    saveConfig();
    broadcast();
  });
}

async function captureThumb(wall, item) {
  if (item.thumb || wall.win.isDestroyed()) return;
  try {
    const image = await wall.win.webContents.capturePage();
    if (image.isEmpty()) return;
    fs.mkdirSync(thumbsDir(), { recursive: true });
    item.thumb = `${item.id}.jpg`;
    item.thumbAt = Date.now();
    fs.writeFileSync(path.join(thumbsDir(), item.thumb), image.resize({ width: 480 }).toJPEG(80));
    saveConfig();
    broadcast();
  } catch {
    // try again next time it shows
  }
}

// ---------- the wallpaper windows ----------

const physical = (display) => screen.dipToScreenRect(null, display.bounds);

function playerState(wall) {
  const item = currentItem();
  if (!item || item.kind === 'web') return null;
  return {
    kind: item.kind,
    src: pathToFileURL(path.join(libraryDir(), item.file)).href,
    fit: config.fit,
    // only the main screen plays sound, so it doesn't echo
    muted: config.muted || !wall.primary,
    volume: config.volume,
    paused: config.paused || autoPaused,
    // with "when a video ends" it plays once, then the next one comes on
    loop: config.autoNext !== 'end' || config.library.length < 2,
  };
}

function loadWall(wall) {
  const item = currentItem();
  if (!item || wall.win.isDestroyed()) return;
  const paused = config.paused || autoPaused;
  if (item.kind === 'web') {
    wall.page = item.id;
    wall.win.loadURL(item.url, item.referrer ? { httpReferrer: item.referrer } : undefined).catch(() => {});
    wall.win.webContents.setAudioMuted(config.muted || !wall.primary);
    // a page can't be paused, so it is hidden instead
    if (paused) wall.win.hide();
    else wall.win.showInactive();
    if (wall.primary) setTimeout(() => captureThumb(wall, item), 5000);
    return;
  }
  wall.win.webContents.setAudioMuted(false);
  if (!wall.win.isVisible()) wall.win.showInactive();
  if (wall.page !== 'player') {
    wall.page = 'player';
    wall.win.loadFile(path.join(__dirname, 'wallpaper', 'player.html')).catch(() => {});
  } else {
    wall.win.webContents.send('player:state', playerState(wall));
  }
  if (wall.primary && !item.thumb) setTimeout(() => captureThumb(wall, item), 3000);
}

function createWall(display) {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    backgroundColor: '#000000',
    title: 'Nova Live wallpaper',
    webPreferences: {
      preload: path.join(__dirname, 'wallpaper', 'preload.js'),
      backgroundThrottling: false,
    },
  });
  win.setMenu(null);
  const wall = { win, display, primary: display.id === screen.getPrimaryDisplay().id, page: null };
  desktop.attach(win, physical(display));
  win.showInactive();
  // pages opening pop-ups would put them on the desktop
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    // Explorer restarting takes our windows with it; put them back
    if (!quitting && !rebuilding) scheduleRebuild(3000);
  });
  return wall;
}

function destroyWalls() {
  rebuilding = true;
  for (const wall of walls) if (!wall.win.isDestroyed()) wall.win.destroy();
  walls = [];
  rebuilding = false;
}

function buildWalls() {
  destroyWalls();
  if (!currentItem()) return;
  walls = screen.getAllDisplays().map(createWall);
  walls.forEach(loadWall);
}

let rebuildTimer = null;
function scheduleRebuild(delay = 1500) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(buildWalls, delay);
}

function applyCurrent() {
  if (!currentItem()) {
    destroyWalls();
    desktop.restoreWallpaper();
  } else if (!walls.length) buildWalls();
  else walls.forEach(loadWall);
  broadcast();
}

function applyPlayback() {
  for (const wall of walls) {
    const item = currentItem();
    if (!item || wall.win.isDestroyed()) continue;
    if (item.kind === 'web') {
      wall.win.webContents.setAudioMuted(config.muted || !wall.primary);
      if (config.paused || autoPaused) wall.win.hide();
      else wall.win.showInactive();
    } else wall.win.webContents.send('player:state', playerState(wall));
  }
  broadcast();
}

function setCurrent(id) {
  config.current = id;
  saveConfig();
  resetAutoNext();
  applyCurrent();
}

ipcMain.on('player:ready', (e) => {
  const wall = walls.find((w) => !w.win.isDestroyed() && w.win.webContents === e.sender);
  if (wall) e.sender.send('player:state', playerState(wall));
});

// ---------- moving on to the next wallpaper ----------

let nextAt = 0; // when the timer moves on, or 0

function autoNextMinutes() {
  if (!config.autoNext) return 0;
  // "when a video ends": pictures and pages still move on after 5 minutes
  if (config.autoNext === 'end') return currentItem()?.kind === 'video' ? 0 : 5;
  return Number(config.autoNext) || 0;
}

function resetAutoNext() {
  const minutes = autoNextMinutes();
  nextAt = minutes && currentItem() && config.library.length > 1 ? Date.now() + minutes * 60000 : 0;
}

function nextWallpaper() {
  const list = config.library;
  if (list.length < 2) return;
  const at = list.findIndex((i) => i.id === config.current);
  let next = list[(at + 1) % list.length];
  if (config.shuffle && list.length > 2) {
    const others = list.filter((i) => i.id !== config.current);
    next = others[Math.floor(Math.random() * others.length)];
  }
  setCurrent(next.id);
}

// the main screen's video finished (only with "when a video ends")
ipcMain.on('player:ended', (e) => {
  const wall = walls.find((w) => !w.win.isDestroyed() && w.win.webContents === e.sender);
  if (wall?.primary && config.autoNext === 'end') nextWallpaper();
});

function tickAutoNext(step) {
  if (!nextAt) return;
  // the countdown stands still while paused
  if (config.paused || autoPaused) nextAt += step;
  else if (Date.now() >= nextAt) nextWallpaper();
}

// Every couple of seconds: is a game covering a screen, and are we still on the desktop?
function watch() {
  setInterval(() => {
    if (!walls.length) return;
    if (walls.some((w) => !desktop.isAttached(w.win))) return scheduleRebuild(500);
    const own = [...walls.map((w) => w.win), control].filter((w) => w && !w.isDestroyed()).map(desktop.handleOf);
    const covered = config.pauseOnFullscreen && desktop.fullscreenAppOpen(screen.getAllDisplays().map(physical), own);
    if (covered !== autoPaused) {
      autoPaused = covered;
      applyPlayback();
    }
    tickAutoNext(2000);
  }, 2000);
}

// ---------- the Nova Live window ----------

function createControl() {
  control = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b0b0c',
    title: 'Nova Live',
    // the top bar doubles as the title bar, with its own minimise / close
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  control.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  control.once('ready-to-show', () => control.show());
  // closing keeps the wallpaper playing from the tray
  control.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    control.hide();
    if (!config.trayTipShown && tray) {
      tray.displayBalloon({
        iconType: 'none',
        title: 'Nova Live is still running',
        content: 'Your wallpaper keeps playing. Open Nova Live again from the tray icon by the clock.',
      });
      config.trayTipShown = true;
      saveConfig();
    }
  });
  control.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showControl() {
  if (!control || control.isDestroyed()) createControl();
  else {
    if (control.isMinimized()) control.restore();
    control.show();
    control.focus();
  }
}

// ---------- tray ----------

function updateTray() {
  if (!tray) return;
  const item = currentItem();
  const recent = config.library.slice(0, 8).map((i) => ({
    label: i.title.length > 48 ? `${i.title.slice(0, 47)}…` : i.title,
    type: 'radio',
    checked: i.id === config.current,
    click: () => setCurrent(i.id),
  }));
  tray.setToolTip(item ? `Nova Live: ${item.title}` : 'Nova Live');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Nova Live', click: showControl },
      { type: 'separator' },
      { label: config.paused ? 'Play' : 'Pause', enabled: !!item, click: () => setSetting({ paused: !config.paused }) },
      { label: 'Next wallpaper', enabled: config.library.length > 1, click: nextWallpaper },
      { label: config.muted ? 'Sound on' : 'Sound off', enabled: !!item, click: () => setSetting({ muted: !config.muted }) },
      { label: 'Wallpapers', enabled: recent.length > 0, submenu: recent.length ? recent : undefined },
      { label: 'Turn wallpaper off', enabled: !!item, click: () => setCurrent(null) },
      { type: 'separator' },
      { label: 'Quit Nova Live', click: () => app.quit() },
    ]),
  );
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'tray.png'));
  tray.on('click', showControl);
  updateTray();
}

// ---------- settings ----------

function applyLoginItem() {
  app.setLoginItemSettings({
    openAtLogin: config.startWithWindows,
    path: process.execPath,
    args: app.isPackaged ? ['--hidden'] : [path.resolve(app.getAppPath()), '--hidden'],
  });
}

function setSetting(change) {
  const allowed = ['paused', 'muted', 'volume', 'fit', 'quality', 'startWithWindows', 'pauseOnFullscreen', 'autoNext', 'shuffle', 'see', 'blur'];
  for (const key of allowed) if (key in change) config[key] = change[key];
  saveConfig();
  if ('startWithWindows' in change) applyLoginItem();
  if ('autoNext' in change) resetAutoNext();
  if ('pauseOnFullscreen' in change && !config.pauseOnFullscreen) autoPaused = false;
  applyPlayback();
}

// ---------- messages from the window ----------

async function guarded(job) {
  if (busy) return { error: 'Still working on the last one…' };
  busy = true;
  broadcast();
  try {
    return await job();
  } catch (e) {
    return { error: `Something went wrong: ${e.message}` };
  } finally {
    busy = false;
    progress(null);
    broadcast();
  }
}

ipcMain.handle('state:get', () => publicState());
ipcMain.handle('add:text', (_e, text) => guarded(() => addFromText(text)));
ipcMain.handle('add:files', (_e, paths) => guarded(async () => addFiles(paths)));
ipcMain.handle('add:novagrid', () => guarded(importNovaGrid));
ipcMain.handle('wall:next', () => {
  nextWallpaper();
  return publicState();
});
ipcMain.handle('add:browse', async () => {
  const result = await dialog.showOpenDialog(control, {
    title: 'Choose a video, picture or web page',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Videos, pictures and pages', extensions: [...VIDEO_TYPES, ...IMAGE_TYPES, ...PAGE_TYPES] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return {};
  return guarded(async () => addFiles(result.filePaths));
});
ipcMain.handle('wall:set', (_e, id) => {
  setCurrent(config.library.some((i) => i.id === id) ? id : null);
  return publicState();
});
ipcMain.handle('wall:remove', async (_e, id) => {
  const item = config.library.find((i) => i.id === id);
  if (!item) return publicState();
  config.library = config.library.filter((i) => i !== item);
  if (config.current === id) config.current = null;
  saveConfig();
  applyCurrent();
  // to the Recycle Bin rather than gone for good
  if (item.file && fs.existsSync(path.join(libraryDir(), item.file))) await shell.trashItem(path.join(libraryDir(), item.file)).catch(() => {});
  if (item.thumb) fs.rm(path.join(thumbsDir(), item.thumb), { force: true }, () => {});
  return publicState();
});
ipcMain.handle('wall:rename', (_e, id, title) => {
  const item = config.library.find((i) => i.id === id);
  if (item && String(title).trim()) {
    item.title = String(title).trim().slice(0, 120);
    saveConfig();
    broadcast();
  }
  return publicState();
});
ipcMain.handle('settings:set', (_e, change) => {
  setSetting(change || {});
  return publicState();
});
ipcMain.handle('library:open', () => {
  fs.mkdirSync(libraryDir(), { recursive: true });
  shell.openPath(libraryDir());
});
ipcMain.handle('source:open', (_e, id) => {
  const item = config.library.find((i) => i.id === id);
  if (item && /^https?:/.test(item.source)) shell.openExternal(item.source);
});
ipcMain.on('win:min', () => control?.minimize());
ipcMain.on('win:close', () => control?.close());

// ---------- start and stop ----------

app.on('second-instance', showControl);
app.on('window-all-closed', () => {}); // keep running in the tray

app.whenReady().then(() => {
  loadConfig();
  resetAutoNext();
  createTray();
  // thumbnails that went missing, one at a time
  config.library
    .filter((i) => i.kind === 'video' && !(i.thumb && fs.existsSync(path.join(thumbsDir(), i.thumb))))
    .reduce((chain, i) => chain.then(() => makeThumb(i)), Promise.resolve());
  if (config.startWithWindows) applyLoginItem();
  if (currentItem()) buildWalls();
  if (!startHidden) createControl();
  watch();
  screen.on('display-added', () => scheduleRebuild());
  screen.on('display-removed', () => scheduleRebuild());
  screen.on('display-metrics-changed', () => scheduleRebuild());
});

app.on('before-quit', () => {
  quitting = true;
  if (walls.length) {
    destroyWalls();
    desktop.restoreWallpaper();
  }
});
