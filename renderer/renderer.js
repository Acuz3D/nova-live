// Line icons, drawn in the text colour (same stroke style as Nova Grid).
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  winMin: '<path d="M6 12h12"/>',
  winClose: '<path d="M7 7l10 10M17 7L7 17"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  sparkle: '<path d="M12 3.5c.6 4.6 3.9 7.9 8.5 8.5-4.6.6-7.9 3.9-8.5 8.5-.6-4.6-3.9-7.9-8.5-8.5 4.6-.6 7.9-3.9 8.5-8.5z"/>',
  play: '<path d="M9 6.5v11l9-5.5z"/>',
  pause: '<path d="M9.5 6.5v11M14.5 6.5v11"/>',
  soundOn: '<path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9.5h3l4.5-4v13L7 14.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  power: '<path d="M12 4v7"/><path d="M7.2 7a7 7 0 1 0 9.6 0"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  pencil: '<path d="M5 19l1-4 10-10 3 3-10 10z"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
  next: '<path d="M6 6.5v11l8-5.5z"/><path d="M17.5 6.5v11"/>',
  repeat: '<path d="M17 3.5l3 3-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12"/><path d="M7 20.5l-3-3 3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/>',
  shuffle: '<path d="M16.5 4.5h3v3M19.5 4.5l-15 15M16.5 19.5h3v-3M14.5 14.5l5 5M4.5 4.5l5 5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`;
const fillIcons = (root = document) => root.querySelectorAll('i[data-icon]').forEach((el) => (el.outerHTML = icon(el.dataset.icon)));
fillIcons();

const $ = (id) => document.getElementById(id);
const KIND_NAME = { video: 'Video', image: 'Picture', web: 'Web page' };
let state = null;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function where(item) {
  if (item.from) return `from ${item.from}`;
  if (/^https?:/.test(item.source || '')) {
    try {
      return new URL(item.source).hostname.replace(/^www\.|^m\./, '');
    } catch {
      return 'link';
    }
  }
  return 'from your PC';
}

const when = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// ---------- drawing the state ----------

function render(s) {
  state = s;
  const root = document.documentElement.style;
  root.setProperty('--see', s.see);
  root.setProperty('--blur', `${s.blur}px`);

  const item = s.library.find((i) => i.id === s.current);
  const paused = s.paused || s.autoPaused;

  // top bar
  $('status').innerHTML = item
    ? `<span class="dot ${paused ? 'still' : ''}"></span>${paused ? (s.paused ? 'Paused' : 'Paused for a full-screen app') : 'Playing'} · ${escapeHtml(item.title)}`
    : '<span class="dot still"></span>Your normal wallpaper';

  // on your desktop
  $('now').classList.toggle('live', !!item);
  $('now-controls').hidden = !item;
  const thumb = $('now-thumb');
  thumb.style.backgroundImage = item?.thumbUrl ? `url("${item.thumbUrl}")` : '';
  thumb.innerHTML = item && !item.thumbUrl ? icon(item.kind) : item ? '' : icon('sparkle');
  $('now-label').textContent = item ? 'On your desktop' : 'Nothing playing';
  $('now-title').textContent = item ? item.title : 'Your normal Windows wallpaper';
  renderSub();
  $('play-btn').innerHTML = icon(s.paused ? 'play' : 'pause');
  $('play-btn').title = s.paused ? 'Play' : 'Pause';
  $('mute-btn').innerHTML = icon(s.muted ? 'soundOff' : 'soundOn');
  $('mute-btn').title = s.muted ? 'Sound is off' : 'Sound is on';
  if (document.activeElement !== $('volume')) $('volume').value = s.muted ? 0 : s.volume;
  const silent = item && item.kind === 'image';
  $('mute-btn').disabled = silent;
  $('volume').disabled = silent;
  $('play-btn').disabled = silent;
  document.querySelectorAll('#fit button').forEach((b) => b.classList.toggle('on', b.dataset.fit === s.fit));
  $('fit').hidden = item?.kind === 'web';
  $('next-btn').disabled = s.library.length < 2;
  $('auto-next').value = String(s.autoNext);
  $('auto-next').closest('.auto-next').classList.toggle('on', !!s.autoNext);
  $('shuffle-btn').classList.toggle('on', s.shuffle);
  $('shuffle-btn').title = s.shuffle ? 'Shuffle is on' : 'Shuffle is off';

  // Nova Grid's background videos that aren't here yet
  $('import-btn').hidden = !s.novaGrid;
  $('import-btn').querySelector('span').textContent = `Bring in ${s.novaGrid} video${s.novaGrid === 1 ? '' : 's'} from Nova Grid`;
  $('import-btn').disabled = s.busy;
  $('opt-import').hidden = !s.novaGrid;
  $('opt-import').disabled = s.busy;

  // the add box
  $('add-btn').disabled = s.busy;
  $('browse-btn').disabled = s.busy;
  $('no-downloader').hidden = s.downloader;

  // settings
  $('opt-start').checked = s.startWithWindows;
  $('opt-fullscreen').checked = s.pauseOnFullscreen;
  $('opt-quality').value = String(s.quality);
  $('opt-see').value = Math.round(s.see * 100);
  $('opt-see-value').textContent = `${Math.round(s.see * 100)}%`;
  $('opt-blur').value = s.blur;
  $('opt-blur-value').textContent = `${s.blur}px`;
  $('about').textContent = `Nova Live ${s.version} · by Nova Studios`;

  renderLibrary(s);
}

// the line under the title, with the auto-next countdown
function renderSub() {
  const s = state;
  const item = s.library.find((i) => i.id === s.current);
  if (!item) {
    $('now-sub').textContent = 'Pick something from your library, or add a link above.';
    return;
  }
  const parts = [KIND_NAME[item.kind], where(item)];
  if (s.autoPaused && !s.paused) parts.push('paused while a full-screen app is open');
  else if (s.nextAt && !s.paused) {
    const mins = Math.max(0, Math.ceil((s.nextAt - Date.now()) / 60000));
    parts.push(mins <= 1 ? 'next in under a minute' : `next in ${mins} min`);
  } else if (s.autoNext === 'end' && item.kind === 'video' && s.library.length > 1) parts.push('next when it ends');
  $('now-sub').textContent = parts.join(' · ');
}
setInterval(() => state && renderSub(), 15000);

function renderLibrary(s) {
  const grid = $('grid');
  if (grid.querySelector('.card-title input')) return; // don't redraw while renaming
  $('count').textContent = s.library.length ? `${s.library.length} saved` : '';
  $('empty').hidden = s.library.length > 0;
  grid.innerHTML = s.library
    .map(
      (i) => `
      <div class="card ${i.id === s.current ? 'current' : ''}" data-id="${i.id}" title="${escapeHtml(i.title)}">
        <div class="card-thumb" style="${i.thumbUrl ? `background-image:url('${i.thumbUrl}')` : ''}">
          ${i.thumbUrl ? '' : icon(i.kind)}
          <span class="badge">${i.id === s.current ? '<span class="dot"></span>Live' : KIND_NAME[i.kind]}</span>
          <div class="card-actions">
            <button data-act="rename" title="Rename">${icon('pencil')}</button>
            ${/^https?:/.test(i.source || '') ? `<button data-act="source" title="Open the original link">${icon('external')}</button>` : ''}
            <button data-act="remove" title="Remove from the library">${icon('trash')}</button>
          </div>
        </div>
        <div class="card-body">
          <span class="card-title">${escapeHtml(i.title)}</span>
          <span class="card-meta">${KIND_NAME[i.kind]} · ${escapeHtml(where(i))} · ${when(i.added)}</span>
        </div>
      </div>`,
    )
    .join('');
}

// ---------- adding ----------

let messageTimer = null;
function say(text, isError = false) {
  const m = $('message');
  clearTimeout(messageTimer);
  m.hidden = !text;
  m.textContent = text || '';
  m.classList.toggle('error', isError);
  if (text && !isError) messageTimer = setTimeout(() => (m.hidden = true), 5000);
}

async function finish(job) {
  say(null);
  const result = await job;
  if (!result) return;
  if (result.error) return say(result.error, true);
  if (result.item) {
    $('link').value = '';
    say(result.again ? `"${result.item.title}" was already in your library, so it's back on your desktop.` : `"${result.item.title}" is on your desktop.`);
  }
}

$('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state?.busy) return;
  finish(window.nova.addText($('link').value));
});

$('browse-btn').addEventListener('click', () => finish(window.nova.browse()));

// Ctrl+V anywhere drops the link in and starts straight away
document.addEventListener('paste', (e) => {
  if (e.target.closest('input')) return;
  const text = e.clipboardData.getData('text').trim();
  if (!text) return;
  $('link').value = text;
  $('add-form').requestSubmit();
});

window.nova.onProgress(({ text, pct }) => {
  $('progress').hidden = !text;
  if (!text) return;
  $('progress-text').textContent = text;
  $('progress').classList.toggle('unknown', pct == null);
  $('progress-fill').style.width = `${pct || 0}%`;
});

// dropping files
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  $('drop').hidden = false;
});
document.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $('drop').hidden = true;
  }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) return finish(window.nova.addFiles(files));
  // a link dragged from the browser
  const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text');
  if (text) {
    $('link').value = text.split('\n')[0].trim();
    $('add-form').requestSubmit();
  }
});

// ---------- controls ----------

$('play-btn').addEventListener('click', () => window.nova.settings({ paused: !state.paused }).then(render));
$('mute-btn').addEventListener('click', () => {
  // turning the sound on at zero volume would do nothing, so give it some
  const change = { muted: !state.muted };
  if (state.muted && state.volume === 0) change.volume = 40;
  window.nova.settings(change).then(render);
});
// Turning the volume up also turns the sound on, so the slider does what it looks like.
$('volume').addEventListener('input', () => {
  const volume = Number($('volume').value);
  window.nova.settings({ volume, muted: volume === 0 }).then(render);
});
$('fit').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-fit]');
  if (b) window.nova.settings({ fit: b.dataset.fit }).then(render);
});
$('off-btn').addEventListener('click', () => window.nova.set(null).then(render));
$('next-btn').addEventListener('click', () => window.nova.next().then(render));
$('auto-next').addEventListener('change', (e) => {
  const v = e.target.value;
  window.nova.settings({ autoNext: v === 'end' ? 'end' : Number(v) }).then(render);
});
$('shuffle-btn').addEventListener('click', () => window.nova.settings({ shuffle: !state.shuffle }).then(render));

async function importNovaGrid() {
  say(null);
  const result = await window.nova.importNovaGrid();
  if (result?.error) say(result.error, true);
  else if (result?.imported) say(`Brought in ${result.imported} video${result.imported === 1 ? '' : 's'} from Nova Grid.`);
}
$('import-btn').addEventListener('click', importNovaGrid);
$('opt-import').addEventListener('click', importNovaGrid);

// library cards: click to use, or the small buttons on top
$('grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const act = e.target.closest('button[data-act]')?.dataset.act;
  if (act === 'source') return window.nova.openSource(id);
  if (act === 'rename') return startRename(card, id);
  if (act === 'remove') {
    const b = e.target.closest('button');
    // two clicks to remove, so a stray click doesn't lose anything
    if (!b.classList.contains('confirm')) {
      b.classList.add('confirm');
      b.textContent = 'Remove?';
      setTimeout(() => state && renderLibrary(state), 3000);
      return;
    }
    return window.nova.remove(id).then(render);
  }
  if (e.target.closest('.card-title input')) return;
  if (id !== state.current) window.nova.set(id).then(render);
});

function startRename(card, id) {
  const title = card.querySelector('.card-title');
  const old = state.library.find((i) => i.id === id)?.title || '';
  title.innerHTML = `<input type="text" value="${escapeHtml(old)}" />`;
  const input = title.querySelector('input');
  input.focus();
  input.select();
  let done = false;
  const end = (save) => {
    if (done) return;
    done = true;
    title.textContent = old;
    if (save && input.value.trim() && input.value.trim() !== old) window.nova.rename(id, input.value).then(render);
    else renderLibrary(state);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') end(true);
    if (e.key === 'Escape') end(false);
  });
  input.addEventListener('blur', () => end(true));
}

// ---------- settings menu ----------

const settingsBtn = $('settings-btn');
const settingsPanel = $('settings-panel');
settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.classList.toggle('open');
  settingsBtn.classList.toggle('open', settingsPanel.classList.contains('open'));
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#settings-menu')) {
    settingsPanel.classList.remove('open');
    settingsBtn.classList.remove('open');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') settingsPanel.classList.remove('open');
});

$('opt-start').addEventListener('change', (e) => window.nova.settings({ startWithWindows: e.target.checked }).then(render));
$('opt-fullscreen').addEventListener('change', (e) => window.nova.settings({ pauseOnFullscreen: e.target.checked }).then(render));
$('opt-quality').addEventListener('change', (e) => window.nova.settings({ quality: Number(e.target.value) }).then(render));
$('opt-see').addEventListener('input', (e) => {
  const see = Number(e.target.value) / 100;
  document.documentElement.style.setProperty('--see', see);
  $('opt-see-value').textContent = `${e.target.value}%`;
});
$('opt-see').addEventListener('change', (e) => window.nova.settings({ see: Number(e.target.value) / 100 }).then(render));
$('opt-blur').addEventListener('input', (e) => {
  document.documentElement.style.setProperty('--blur', `${e.target.value}px`);
  $('opt-blur-value').textContent = `${e.target.value}px`;
});
$('opt-blur').addEventListener('change', (e) => window.nova.settings({ blur: Number(e.target.value) }).then(render));

$('folder-btn').addEventListener('click', () => window.nova.openLibrary());
$('win-min').addEventListener('click', () => window.nova.minimise());
$('win-close').addEventListener('click', () => window.nova.close());

window.nova.onState(render);
window.nova.state().then(render);
$('link').focus();
