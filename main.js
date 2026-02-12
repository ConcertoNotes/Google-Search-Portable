const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  screen,
  session,
  net,
} = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

// ── Disable hardware acceleration to fix Windows DWM border on transparent windows ──
app.disableHardwareAcceleration();

// ── Chromium flags for better IME compatibility ──────────────
app.commandLine.appendSwitch("enable-features", "ImeThread");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

// ── Single instance lock ─────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

// ── Constants ────────────────────────────────────────────────
const WINDOW_SIZE_DEFAULT = { width: 680, height: 180 };
const WINDOW_SIZE_AGGREGATE_EXPANDED = { width: 900, height: 600 };

const SEARCH_SOURCES = [
  { id: "github", name: "GitHub", icon: "GH", loginUrl: "https://github.com/login", searchNeedsLogin: false, webSearchUrl: "https://github.com/search?q=%s&type=repositories" },
  { id: "linuxdo", name: "linux.do", icon: "LD", loginUrl: "https://linux.do/login", searchNeedsLogin: false, webSearchUrl: "https://linux.do/search?q=%s" },
  { id: "x", name: "X (Twitter)", icon: "X", loginUrl: "https://x.com/i/flow/login", searchNeedsLogin: true, webSearchUrl: "https://x.com/search?q=%s" },
  { id: "stackoverflow", name: "Stack Overflow", icon: "SO", loginUrl: "https://stackoverflow.com/users/login", searchNeedsLogin: false, webSearchUrl: "https://stackoverflow.com/search?q=%s" },
  { id: "reddit", name: "Reddit", icon: "RD", loginUrl: "https://www.reddit.com/login", searchNeedsLogin: false, webSearchUrl: "https://www.reddit.com/search/?q=%s" },
  { id: "hackernews", name: "Hacker News", icon: "HN", loginUrl: "https://news.ycombinator.com/login", searchNeedsLogin: false, webSearchUrl: "https://hn.algolia.com/?q=%s" },
];

// ── State ────────────────────────────────────────────────────
let mainWindow = null;
let currentMode = "default";
let loginWindows = {};

// ── Chromium Fetch Helpers ────────────────────────────────────
// Uses Electron's net.fetch (Chromium network stack) instead of Node.js https.
// This bypasses Cloudflare, anti-bot TLS fingerprinting, and handles
// gzip/deflate/br automatically.

async function chromeFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    const response = await net.fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Request timeout");
    throw err;
  }
}

async function sessionFetch(partitionName, url, options = {}) {
  const ses = session.fromPartition(partitionName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 15000);
  try {
    const response = await ses.fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Request timeout");
    throw err;
  }
}

// ── HTML entity decoder (for SO API) ─────────────────────────
function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

// ── Per-source Search Functions ──────────────────────────────

async function searchGitHub(query) {
  const encoded = encodeURIComponent(query);

  // Parallel: repos (best match) + issues for comprehensive results
  const [repoRes, issueRes] = await Promise.all([
    chromeFetch(
      `https://api.github.com/search/repositories?q=${encoded}&per_page=30`,
      { headers: { Accept: "application/vnd.github.v3+json" } }
    ),
    chromeFetch(
      `https://api.github.com/search/issues?q=${encoded}&per_page=10&sort=relevance`,
      { headers: { Accept: "application/vnd.github.v3+json" } }
    ),
  ]);

  if (!repoRes.ok) throw new Error(`HTTP ${repoRes.status}`);

  const repoData = await repoRes.json();
  let totalCount = repoData.total_count || 0;
  const results = (repoData.items || []).map((item) => ({
    title: item.full_name,
    url: item.html_url,
    snippet: [
      item.stargazers_count ? `\u2B50${item.stargazers_count.toLocaleString()}` : "",
      item.language || "",
      item.description || "",
    ]
      .filter(Boolean)
      .join(" \u00B7 "),
  }));

  // Append issue results if available
  if (issueRes.ok) {
    try {
      const issueData = await issueRes.json();
      totalCount += issueData.total_count || 0;
      for (const item of (issueData.items || []).slice(0, 10)) {
        results.push({
          title: item.title,
          url: item.html_url,
          snippet: item.body
            ? item.body.substring(0, 200).replace(/\n/g, " ")
            : "",
        });
      }
    } catch {
      // Ignore issue search failures
    }
  }

  return { results, totalCount };
}

async function searchStackOverflow(query) {
  const response = await chromeFetch(
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=30`
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return {
    results: (data.items || []).map((item) => ({
      title: decodeHTMLEntities(item.title || ""),
      url: item.link,
      snippet: [
        `${item.answer_count || 0} answers`,
        `${item.score || 0} votes`,
        (item.tags || []).slice(0, 4).join(", "),
      ].join(" \u00B7 "),
    })),
    totalCount: data.total || null,
  };
}

async function searchHackerNews(query) {
  const response = await chromeFetch(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=30`
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return {
    results: (data.hits || []).map((hit) => ({
      title: hit.title || hit.story_title || "Untitled",
      url:
        hit.url ||
        `https://news.ycombinator.com/item?id=${hit.objectID}`,
      snippet: hit.author
        ? `by ${hit.author} \u00B7 ${hit.points || 0} points \u00B7 ${hit.num_comments || 0} comments`
        : "",
    })),
    totalCount: data.nbHits || null,
  };
}

async function searchReddit(query) {
  // Use session fetch for Chromium TLS fingerprint + any login cookies
  const response = await sessionFetch(
    "persist:reddit",
    `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=25&sort=relevance&t=all`
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data.data || !data.data.children) return { results: [], totalCount: null };
  return {
    results: data.data.children
      .filter((child) => child.kind === "t3")
      .map((child) => ({
        title: child.data.title || "",
        url: `https://www.reddit.com${child.data.permalink}`,
        snippet: child.data.selftext
          ? child.data.selftext.substring(0, 200)
          : `r/${child.data.subreddit} \u00B7 ${child.data.score} points \u00B7 ${child.data.num_comments} comments`,
      })),
    totalCount: null,
  };
}

async function searchLinuxDo(query) {
  // Use session fetch - includes login cookies and Chromium TLS fingerprint
  const response = await sessionFetch(
    "persist:linuxdo",
    `https://linux.do/search.json?q=${encodeURIComponent(query)}`,
    { headers: { Accept: "application/json" } }
  );

  if (response.status === 403 || response.status === 401 || response.status === 429) {
    throw new Error("NEEDS_LOGIN");
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  let data;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response (Cloudflare challenge page etc.)
    throw new Error("NEEDS_LOGIN");
  }

  const topics = data.topics || [];
  const posts = data.posts || [];
  const results = topics.map((topic) => ({
    title: topic.title || "",
    url: `https://linux.do/t/${topic.slug || "-"}/${topic.id}`,
    snippet: topic.excerpt || topic.blurb || "",
  }));

  // Enrich snippets from posts
  for (const post of posts) {
    const topicResult = results.find((r) =>
      r.url.includes(`/${post.topic_id}`)
    );
    if (topicResult && !topicResult.snippet && post.blurb) {
      topicResult.snippet = post.blurb;
    }
  }

  return { results, totalCount: null };
}

async function searchX(query) {
  const ses = session.fromPartition("persist:x");
  const cookies = await ses.cookies.get({ url: "https://x.com" });
  const hasAuth = cookies.some(
    (c) => c.name === "auth_token" || c.name === "ct0"
  );

  if (!hasAuth) {
    throw new Error("NEEDS_LOGIN");
  }

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1024,
      height: 768,
      show: false,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    let done = false;
    const finish = (results) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        win.destroy();
      } catch {}
      resolve({ results, totalCount: null });
    };

    const timer = setTimeout(() => finish([]), 15000);

    win.webContents.on("did-finish-load", () => {
      // Check if redirected to login
      const currentUrl = win.webContents.getURL();
      if (
        currentUrl.includes("/login") ||
        currentUrl.includes("/i/flow")
      ) {
        finish([]);
        return;
      }

      // Poll for results as X is a SPA
      let attempts = 0;
      const checkResults = async () => {
        if (done) return;
        attempts++;
        try {
          const results = await win.webContents.executeJavaScript(`
            (() => {
              const articles = document.querySelectorAll('article[data-testid="tweet"]');
              if (!articles.length) return null;
              return Array.from(articles).slice(0, 10).map(a => {
                const text = a.querySelector('[data-testid="tweetText"]');
                const link = a.querySelector('a[href*="/status/"]');
                const nameEl = a.querySelector('[data-testid="User-Name"]');
                return {
                  title: nameEl ? nameEl.innerText.split('\\n')[0] : 'Tweet',
                  url: link ? link.href : '',
                  snippet: text ? text.innerText.substring(0, 200) : '',
                };
              }).filter(r => r.url);
            })()
          `);

          if (results && results.length > 0) {
            finish(results);
          } else if (attempts < 8) {
            setTimeout(checkResults, 1500);
          } else {
            finish([]);
          }
        } catch {
          if (attempts < 8) {
            setTimeout(checkResults, 1500);
          } else {
            finish([]);
          }
        }
      };

      setTimeout(checkResults, 2000);
    });

    win.webContents.on("did-fail-load", () => finish([]));

    const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=top`;
    win.loadURL(searchUrl);
  });
}

// ── Search Dispatcher ────────────────────────────────────────
async function searchSource(query, source) {
  try {
    let searchResult;
    switch (source.id) {
      case "github":
        searchResult = await searchGitHub(query);
        break;
      case "stackoverflow":
        searchResult = await searchStackOverflow(query);
        break;
      case "hackernews":
        searchResult = await searchHackerNews(query);
        break;
      case "reddit":
        searchResult = await searchReddit(query);
        break;
      case "linuxdo":
        searchResult = await searchLinuxDo(query);
        break;
      case "x":
        searchResult = await searchX(query);
        break;
      default:
        searchResult = { results: [], totalCount: null };
    }
    return {
      sourceId: source.id,
      results: searchResult.results,
      totalCount: searchResult.totalCount,
      error: null,
      needsLogin: false,
    };
  } catch (err) {
    if (err.message === "NEEDS_LOGIN") {
      return { sourceId: source.id, results: [], totalCount: null, error: null, needsLogin: true };
    }
    return { sourceId: source.id, results: [], totalCount: null, error: err.message, needsLogin: false };
  }
}

// ── Window ───────────────────────────────────────────────────
function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenW, height: screenH } = display.workAreaSize;

  mainWindow = new BrowserWindow({
    width: WINDOW_SIZE_DEFAULT.width,
    height: WINDOW_SIZE_DEFAULT.height,
    x: Math.round((screenW - WINDOW_SIZE_DEFAULT.width) / 2),
    y: Math.round(screenH * 0.3),
    title: "",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    thickFrame: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    movable: true,
    minWidth: 400,
    minHeight: 150,
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

  // Hide instead of close (keep app running, shortcut brings it back)
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Block navigation & new windows
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

// ── Window resize helper ─────────────────────────────────────
function resizeWindowTo(width, height) {
  if (!mainWindow) return;

  const [currentX, currentY] = mainWindow.getPosition();
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

  // Keep current position but ensure window stays on-screen
  let newX = currentX;
  let newY = currentY;
  if (newX + width > dx + dw) newX = dx + dw - width;
  if (newY + height > dy + dh) newY = dy + dh - height;
  if (newX < dx) newX = dx;
  if (newY < dy) newY = dy;

  mainWindow.setBounds({ x: newX, y: newY, width, height });
}

function showWidget() {
  if (!mainWindow) return;

  // Toggle: if visible and focused, minimize
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.minimize();
    return;
  }

  // Restore from minimized
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  // Show if hidden
  if (!mainWindow.isVisible()) {
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

    const size =
      currentMode === "aggregate"
        ? WINDOW_SIZE_AGGREGATE_EXPANDED
        : WINDOW_SIZE_DEFAULT;

    mainWindow.setBounds({
      x: Math.round(dx + (dw - size.width) / 2),
      y: Math.round(dy + dh * 0.3),
      width: size.width,
      height: size.height,
    });
    mainWindow.show();
  }

  mainWindow.focus();
  mainWindow.webContents.send("widget:activated");
}

// ── Open URL in Chrome / fallback browser ────────────────────
function openUrl(url) {
  if (typeof url !== "string" || !url.startsWith("http")) return;

  const chromePath = findChrome();
  if (chromePath) {
    try {
      const child = spawn(chromePath, [url], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      child.on("error", async () => {
        await shell.openExternal(url);
      });
    } catch {
      shell.openExternal(url);
    }
  } else {
    shell.openExternal(url);
  }
}

function findChrome() {
  const candidates = [
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google", "Chrome", "Application", "chrome.exe"
    ),
    path.join(
      process.env["ProgramFiles"] || "C:\\Program Files",
      "Google", "Chrome", "Application", "chrome.exe"
    ),
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Google", "Chrome", "Application", "chrome.exe"
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

// ── Login Management ─────────────────────────────────────────
function openLoginWindow(sourceId) {
  if (loginWindows[sourceId]) {
    loginWindows[sourceId].focus();
    return;
  }

  const source = SEARCH_SOURCES.find((s) => s.id === sourceId);
  if (!source) return;

  const ses = session.fromPartition(`persist:${sourceId}`);

  const loginWin = new BrowserWindow({
    width: 1000,
    height: 700,
    title: `登录 - ${source.name}`,
    parent: null,
    modal: false,
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  loginWindows[sourceId] = loginWin;
  loginWin.loadURL(source.loginUrl);

  loginWin.on("closed", () => {
    delete loginWindows[sourceId];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("auth:changed", { sourceId });
      mainWindow.focus();
    }
  });
}

async function checkLoginStatus(sourceId) {
  const source = SEARCH_SOURCES.find((s) => s.id === sourceId);
  if (!source) return false;

  const urlMap = {
    github: "https://github.com",
    linuxdo: "https://linux.do",
    x: "https://x.com",
    stackoverflow: "https://stackoverflow.com",
    reddit: "https://www.reddit.com",
    hackernews: "https://news.ycombinator.com",
  };

  const url = urlMap[sourceId];
  if (!url) return false;

  try {
    const ses = session.fromPartition(`persist:${sourceId}`);
    const cookies = await ses.cookies.get({ url });
    return cookies.length > 0;
  } catch {
    return false;
  }
}

async function getAllLoginStatus() {
  const status = {};
  for (const source of SEARCH_SOURCES) {
    status[source.id] = await checkLoginStatus(source.id);
  }
  return status;
}

async function logoutSource(sourceId) {
  const ses = session.fromPartition(`persist:${sourceId}`);
  await ses.clearStorageData();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:changed", { sourceId });
  }
}

// ── App lifecycle ────────────────────────────────────────────
app.whenReady().then(() => {
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

  // IPC: default search
  ipcMain.handle("search:submit", async (_event, query) => {
    if (typeof query !== "string") return { ok: false };
    const q = query.trim();
    if (q.length === 0 || q.length > 2000) return { ok: false };
    mainWindow.hide();
    try {
      openUrl(`https://www.google.com/search?q=${encodeURIComponent(q)}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // IPC: aggregate search (parallel, native APIs)
  ipcMain.handle("search:aggregate", async (_event, query) => {
    if (typeof query !== "string") return { ok: false, results: {} };
    const q = query.trim();
    if (q.length === 0 || q.length > 2000) return { ok: false, results: {} };

    const allResults = {};

    const promises = SEARCH_SOURCES.map(async (source) => {
      const result = await searchSource(q, source);
      allResults[result.sourceId] = {
        results: result.results,
        totalCount: result.totalCount,
        error: result.error,
        needsLogin: result.needsLogin,
      };
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("search:partial", {
          sourceId: result.sourceId,
          data: allResults[result.sourceId],
        });
      }
    });

    await Promise.all(promises);
    return { ok: true, results: allResults };
  });

  // IPC: search single source (for re-search after login)
  ipcMain.handle("search:single", async (_event, query, sourceId) => {
    const source = SEARCH_SOURCES.find((s) => s.id === sourceId);
    if (!source) return { sourceId, results: [], error: "Unknown source", needsLogin: false };
    return await searchSource(query, source);
  });

  // IPC: open result URL
  ipcMain.handle("result:open", async (_event, url) => {
    openUrl(url);
    return { ok: true };
  });

  // IPC: resize window
  ipcMain.handle("window:resize", async (_event, width, height) => {
    resizeWindowTo(width, height);
    return { ok: true };
  });

  // IPC: get sources list
  ipcMain.handle("sources:list", async () => {
    return SEARCH_SOURCES;
  });

  // IPC: mode change
  ipcMain.handle("mode:change", async (_event, mode) => {
    currentMode = mode;
    return { ok: true };
  });

  // IPC: auth - login
  ipcMain.handle("auth:login", async (_event, sourceId) => {
    openLoginWindow(sourceId);
    return { ok: true };
  });

  // IPC: auth - logout
  ipcMain.handle("auth:logout", async (_event, sourceId) => {
    await logoutSource(sourceId);
    return { ok: true };
  });

  // IPC: auth - status
  ipcMain.handle("auth:status", async () => {
    return await getAllLoginStatus();
  });

  // IPC: hide widget
  ipcMain.on("widget:hide", () => {
    if (mainWindow) mainWindow.hide();
  });

  // IPC: minimize widget
  ipcMain.on("widget:minimize", () => {
    if (mainWindow) mainWindow.minimize();
  });

  // IPC: window drag-resize from custom handles
  let resizeState = null;
  ipcMain.on("window:startResize", (_event, direction, startX, startY) => {
    if (!mainWindow) return;
    resizeState = {
      direction,
      startX,
      startY,
      startBounds: mainWindow.getBounds(),
    };
  });

  ipcMain.on("window:resizeDrag", (_event, currentX, currentY) => {
    if (!resizeState || !mainWindow) return;
    const { direction, startX, startY, startBounds } = resizeState;
    const dx = currentX - startX;
    const dy = currentY - startY;

    const b = { ...startBounds };

    if (direction.includes("e")) b.width += dx;
    if (direction.includes("s")) b.height += dy;
    if (direction.includes("w")) { b.x += dx; b.width -= dx; }
    if (direction.includes("n")) { b.y += dy; b.height -= dy; }

    // Enforce minimum size
    const minW = 400, minH = 150;
    if (b.width < minW) {
      if (direction.includes("w")) b.x = startBounds.x + startBounds.width - minW;
      b.width = minW;
    }
    if (b.height < minH) {
      if (direction.includes("n")) b.y = startBounds.y + startBounds.height - minH;
      b.height = minH;
    }

    mainWindow.setBounds(b);
  });

  ipcMain.on("window:stopResize", () => {
    resizeState = null;
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
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
