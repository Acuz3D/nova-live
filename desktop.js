// Puts a window behind the desktop icons, the way Wallpaper Engine and Lively do.
//
// Sending Progman the undocumented 0x052C message makes Explorer split the
// desktop into the icon layer (SHELLDLL_DefView) and a WorkerW that holds the
// picture. Before Windows 11 24H2 that WorkerW is a top-level window and our
// window simply becomes its child. From 24H2 on, both live inside Progman, so
// our window goes into Progman too, slotted between the icons and the WorkerW.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });
const EnumProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
const w = {
  FindWindowW: user32.func('intptr_t __stdcall FindWindowW(str16 cls, str16 title)'),
  FindWindowExW: user32.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, str16 cls, str16 title)'),
  EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
  SendMessageTimeoutW: user32.func('intptr_t __stdcall SendMessageTimeoutW(intptr_t hwnd, uint32 msg, uintptr_t wParam, intptr_t lParam, uint32 flags, uint32 timeout, _Out_ uintptr_t *result)'),
  SetParent: user32.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
  GetParent: user32.func('intptr_t __stdcall GetParent(intptr_t hwnd)'),
  IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hwnd)'),
  GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
  SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)'),
  SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32 flags)'),
  SetLayeredWindowAttributes: user32.func('bool __stdcall SetLayeredWindowAttributes(intptr_t hwnd, uint32 key, uint8 alpha, uint32 flags)'),
  ScreenToClient: user32.func('bool __stdcall ScreenToClient(intptr_t hwnd, _Inout_ POINT *pt)'),
  GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
  GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *rect)'),
  GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ uint8 *buf, int max)'),
  SystemParametersInfoW: user32.func('bool __stdcall SystemParametersInfoW(uint32 action, uint32 param, _Inout_ uint8 *buf, uint32 winIni)'),
};

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CHILD = 0x40000000;
const WS_VISIBLE = 0x10000000;
const WS_EX_LAYERED = 0x80000;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_NOACTIVATE = 0x8000000;
const LWA_ALPHA = 0x2;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOZORDER = 0x4;
const SWP_NOACTIVATE = 0x10;
const SWP_FRAMECHANGED = 0x20;
const SWP_SHOWWINDOW = 0x40;
const SMTO_NORMAL = 0;
const HWND_BOTTOM = 1;

const handleOf = (win) => {
  const buf = win.getNativeWindowHandle();
  return buf.length === 8 ? Number(buf.readBigInt64LE()) : buf.readInt32LE();
};

function className(hwnd) {
  const buf = Buffer.alloc(512);
  const n = w.GetClassNameW(hwnd, buf, 256);
  return buf.toString('utf16le', 0, n * 2);
}

// Where the wallpaper window should go, worked out fresh each time because
// Explorer rebuilds these windows when it restarts.
function findLayers() {
  const progman = w.FindWindowW('Progman', null);
  if (!progman) return null;
  // ask Explorer to make the WorkerW (harmless if it already exists)
  w.SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, SMTO_NORMAL, 1000, [0]);
  w.SendMessageTimeoutW(progman, 0x052c, 0, 0, SMTO_NORMAL, 1000, [0]);

  // 24H2 and later: icons and WorkerW are both inside Progman
  const innerIcons = w.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
  const innerWorker = w.FindWindowExW(progman, 0, 'WorkerW', null);
  if (innerIcons && innerWorker) return { modern: true, parent: progman, icons: innerIcons, worker: innerWorker };

  // older Windows: the WorkerW right after the one holding the icons
  let worker = 0;
  w.EnumWindows((hwnd) => {
    if (w.FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null)) {
      worker = w.FindWindowExW(0, hwnd, 'WorkerW', null);
      return false;
    }
    return true;
  }, 0);
  if (worker) return { modern: false, parent: worker };
  // last resort: straight into Progman, which still sits under the icons
  return { modern: false, parent: progman };
}

// bounds are in physical screen pixels
function attach(win, bounds) {
  const hwnd = handleOf(win);
  const layers = findLayers();
  if (!layers) return false;

  const style = Number(w.GetWindowLongPtrW(hwnd, GWL_STYLE));
  w.SetWindowLongPtrW(hwnd, GWL_STYLE, ((style & ~0xffff0000) | WS_CHILD | WS_VISIBLE) >>> 0);
  let ex = Number(w.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
  // inside Progman, Windows only draws children that are layered
  if (layers.modern) ex |= WS_EX_LAYERED;
  w.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex >>> 0);
  if (layers.modern) w.SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);

  w.SetParent(hwnd, layers.parent);
  place(hwnd, layers.parent, bounds);
  if (layers.modern) {
    // icons on top, then us (one window per screen), then Windows' own picture
    w.SetWindowPos(hwnd, layers.icons, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    w.SetWindowPos(layers.worker, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  }
  return true;
}

function place(hwnd, parent, bounds) {
  const pt = { x: bounds.x, y: bounds.y };
  w.ScreenToClient(parent, pt);
  w.SetWindowPos(hwnd, 0, pt.x, pt.y, bounds.width, bounds.height,
    SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
}

// Still behind the icons? Explorer restarting takes the parent away.
function isAttached(win) {
  if (win.isDestroyed()) return false;
  const parent = w.GetParent(handleOf(win));
  return !!parent && w.IsWindow(parent);
}

// Windows keeps showing the last frame we drew until it repaints its own
// picture, so setting the same picture again puts it back.
function restoreWallpaper() {
  const buf = Buffer.alloc(1040);
  if (!w.SystemParametersInfoW(0x73, 520, buf, 0)) return; // SPI_GETDESKWALLPAPER
  w.SystemParametersInfoW(0x14, 0, buf, 0); // SPI_SETDESKWALLPAPER, without saving anything
}

// Is a game or video filling one of the screens? `screens` are physical rects.
const DESKTOP_CLASSES = ['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', ''];
function fullscreenAppOpen(screens, ownHandles) {
  const hwnd = w.GetForegroundWindow();
  if (!hwnd || ownHandles.includes(hwnd)) return false;
  if (DESKTOP_CLASSES.includes(className(hwnd))) return false;
  const r = {};
  if (!w.GetWindowRect(hwnd, r)) return false;
  return screens.some((s) => r.left <= s.x && r.top <= s.y && r.right >= s.x + s.width && r.bottom >= s.y + s.height);
}

module.exports = { attach, place, isAttached, restoreWallpaper, fullscreenAppOpen, handleOf };
