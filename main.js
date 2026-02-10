const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  screen,
} = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

// ── NOTE: Hardware acceleration is required for backgroundMaterial: 'acrylic' ──

// ── Chromium flags for better IME compatibility ──────────────
app.commandLine.appendSwitch("enable-features", "ImeThread");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

// ── Single instance lock ─────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

let mainWindow = null;

// ── Window ───────────────────────────────────────────────────
function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  mainWindow = new BrowserWindow({
    width: 680,
    height: 180,
    x: Math.round((screenW - 680) / 2),
    y: Math.round(screenH * 0.3),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("blur", () => {
    mainWindow.hide();
  });

  // Block navigation & new windows
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function showWidget() {
  if (!mainWindow) return;
  // Position on the display nearest to the cursor
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  mainWindow.setPosition(
    Math.round(dx + (dw - 680) / 2),
    Math.round(dy + dh * 0.3)
  );
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("widget:activated");
}

// ── Chrome detection (Windows) ───────────────────────────────
function findChrome() {
  const candidates = [
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
    path.join(
      process.env["ProgramFiles"] || "C:\\Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* skip */
    }
  }
  return null;
}

async function openSearch(query) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  const chromePath = findChrome();

  if (chromePath) {
    try {
      const child = spawn(chromePath, [url], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      child.on("error", async () => {
        // Chrome spawn failed – fall back to default browser
        await shell.openExternal(url);
      });
    } catch {
      await shell.openExternal(url);
    }
  } else {
    await shell.openExternal(url);
  }
}

// ── App lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
  // Auto-start on login
  app.setLoginItemSettings({ openAtLogin: true });

  createWindow();

  // Try Ctrl+Space, fall back to Alt+Space
  const SHORTCUTS = ["CommandOrControl+Space", "Alt+Space"];
  let registered = false;
  for (const key of SHORTCUTS) {
    if (globalShortcut.register(key, () => showWidget())) {
      console.log(`Global shortcut registered: ${key}`);
      registered = true;
      break;
    }
  }
  if (!registered) {
    console.error(
      "Failed to register any global shortcut. All candidates occupied."
    );
  }

  // IPC: search submit
  ipcMain.handle("search:submit", async (_event, query) => {
    if (typeof query !== "string") return { ok: false };
    const q = query.trim();
    if (q.length === 0 || q.length > 2000) return { ok: false };
    mainWindow.hide();
    try {
      await openSearch(q);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // IPC: hide widget
  ipcMain.on("widget:hide", () => {
    if (mainWindow) mainWindow.hide();
  });
});

app.on("second-instance", () => {
  showWidget();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
