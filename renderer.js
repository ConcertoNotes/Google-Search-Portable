// ── State ────────────────────────────────────────────────────
let currentTab = "default";
let aggregateResults = {};
let activeSourceId = null;
let isSearching = false;
let sources = [];
let authStatus = {};
let lastQuery = "";

// ── DOM Elements ─────────────────────────────────────────────
const tabBtns = document.querySelectorAll(".tab-btn");
const viewDefault = document.getElementById("view-default");
const viewAggregate = document.getElementById("view-aggregate");
const searchInput = document.getElementById("search-input");
const aggregateInput = document.getElementById("aggregate-input");
const resultsContainer = document.getElementById("results-container");
const resultsSidebar = document.getElementById("results-sidebar");
const resultsContent = document.getElementById("results-content");

// ── Window Sizes ─────────────────────────────────────────────
const SIZE_DEFAULT = { width: 680, height: 180 };
const SIZE_AGGREGATE = { width: 680, height: 180 };
const SIZE_AGGREGATE_EXPANDED = { width: 900, height: 600 };

// ── Tab Switching ────────────────────────────────────────────
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    if (tab === currentTab) return;
    switchTab(tab);
  });
});

function switchTab(tab) {
  currentTab = tab;

  tabBtns.forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });

  viewDefault.classList.toggle("active", tab === "default");
  viewAggregate.classList.toggle("active", tab === "aggregate");

  if (tab === "default") {
    window.widgetAPI.resizeWindow(SIZE_DEFAULT.width, SIZE_DEFAULT.height);
    window.widgetAPI.changeMode("default");
    searchInput.focus();
    searchInput.select();
  } else {
    // Restore previous results if available
    if (Object.keys(aggregateResults).length > 0) {
      window.widgetAPI.resizeWindow(
        SIZE_AGGREGATE_EXPANDED.width,
        SIZE_AGGREGATE_EXPANDED.height
      );
      resultsContainer.style.display = "flex";
    } else {
      window.widgetAPI.resizeWindow(SIZE_AGGREGATE.width, SIZE_AGGREGATE.height);
      resultsContainer.style.display = "none";
    }
    window.widgetAPI.changeMode("aggregate");
    aggregateInput.focus();
  }
}

// ── Default Search ───────────────────────────────────────────
searchInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const q = searchInput.value.trim();
    if (!q) return;
    try {
      const result = await window.widgetAPI.submitSearch(q);
      if (result && result.ok) {
        searchInput.value = "";
      }
    } catch {
      // IPC failure
    }
  }
  if (e.key === "Escape") {
    window.widgetAPI.minimizeWidget();
  }
});

// ── Aggregate Search ─────────────────────────────────────────
aggregateInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const q = aggregateInput.value.trim();
    if (!q || isSearching) return;
    await performAggregateSearch(q);
  }
  if (e.key === "Escape") {
    window.widgetAPI.minimizeWidget();
  }
});

async function performAggregateSearch(query) {
  isSearching = true;
  aggregateResults = {};
  activeSourceId = null;
  lastQuery = query;

  // Expand window
  await window.widgetAPI.resizeWindow(
    SIZE_AGGREGATE_EXPANDED.width,
    SIZE_AGGREGATE_EXPANDED.height
  );
  resultsContainer.style.display = "flex";

  renderSidebar(true);
  renderContent(null);

  try {
    await window.widgetAPI.aggregateSearch(query);
  } catch {
    // Errors handled via partial results
  }

  isSearching = false;
  renderSidebar(false);

  // Auto-select first source with results
  if (!activeSourceId) {
    const firstWithResults = sources.find(
      (s) =>
        aggregateResults[s.id] && aggregateResults[s.id].results.length > 0
    );
    if (firstWithResults) {
      selectSource(firstWithResults.id);
    } else {
      renderContent(null);
    }
  }
}

// ── Partial Results Handler ──────────────────────────────────
window.widgetAPI.onPartialResult((data) => {
  aggregateResults[data.sourceId] = data.data;
  renderSidebar(isSearching);

  // Auto-select first source that arrives with results
  if (!activeSourceId && data.data.results && data.data.results.length > 0) {
    selectSource(data.sourceId);
  }
});

// ── Sidebar Rendering ────────────────────────────────────────
function renderSidebar(loading) {
  resultsSidebar.innerHTML = "";

  sources.forEach((source) => {
    const item = document.createElement("div");
    item.className = "sidebar-item";
    if (source.id === activeSourceId) item.classList.add("active");

    const data = aggregateResults[source.id];
    const isLoading = loading && !data;
    if (isLoading) item.classList.add("loading");

    // Left: icon + name + auth dot
    const nameSpan = document.createElement("div");
    nameSpan.className = "sidebar-item-name";

    const icon = document.createElement("span");
    icon.className = "sidebar-icon";
    icon.textContent = source.icon;

    const name = document.createElement("span");
    name.textContent = source.name;

    nameSpan.appendChild(icon);
    nameSpan.appendChild(name);

    if (authStatus[source.id]) {
      const dot = document.createElement("span");
      dot.className = "auth-dot";
      nameSpan.appendChild(dot);
    }

    // Right: count or login button
    const right = document.createElement("span");

    if (data && data.needsLogin) {
      // Show login badge
      right.className = "sidebar-login";
      right.textContent = "登录";
      right.addEventListener("click", (e) => {
        e.stopPropagation();
        window.widgetAPI.login(source.id);
      });
    } else if (isLoading) {
      right.className = "sidebar-count loading-dots";
    } else if (data) {
      right.className = "sidebar-count";
      if (data.error) {
        right.textContent = "!";
        right.style.color = "#d93025";
        right.title = data.error;
      } else {
        const count = data.results.length;
        if (data.totalCount && data.totalCount > count) {
          right.textContent = count + "+";
          right.title = `共 ${data.totalCount.toLocaleString()} 个结果`;
        } else {
          right.textContent = count;
        }
      }
    } else {
      right.className = "sidebar-count";
      right.textContent = "-";
    }

    item.appendChild(nameSpan);
    item.appendChild(right);

    item.addEventListener("click", () => {
      if (data && data.needsLogin) {
        window.widgetAPI.login(source.id);
      } else {
        selectSource(source.id);
      }
    });

    resultsSidebar.appendChild(item);
  });
}

// ── Source Selection ──────────────────────────────────────────
function selectSource(sourceId) {
  activeSourceId = sourceId;
  renderSidebar(isSearching);
  renderContent(sourceId);
}

// ── Content Rendering ────────────────────────────────────────
function renderContent(sourceId) {
  resultsContent.innerHTML = "";

  if (!sourceId) {
    if (isSearching) {
      resultsContent.innerHTML =
        '<div class="loading-spinner"><div class="spinner"></div><span>正在搜索...</span></div>';
    } else {
      const hasAny = sources.some(
        (s) =>
          aggregateResults[s.id] &&
          aggregateResults[s.id].results &&
          aggregateResults[s.id].results.length > 0
      );
      if (!hasAny && Object.keys(aggregateResults).length > 0) {
        resultsContent.innerHTML =
          '<div class="empty-state">未找到结果</div>';
      } else if (Object.keys(aggregateResults).length === 0) {
        resultsContent.innerHTML =
          '<div class="loading-spinner"><div class="spinner"></div><span>正在搜索...</span></div>';
      } else {
        resultsContent.innerHTML =
          '<div class="empty-state">选择左侧来源查看结果</div>';
      }
    }
    return;
  }

  const data = aggregateResults[sourceId];
  if (!data) {
    resultsContent.innerHTML =
      '<div class="loading-spinner"><div class="spinner"></div><span>加载中...</span></div>';
    return;
  }

  // Needs login prompt
  if (data.needsLogin) {
    const source = sources.find((s) => s.id === sourceId);
    const prompt = document.createElement("div");
    prompt.className = "login-prompt";

    const msg = document.createElement("div");
    msg.textContent = `${source ? source.name : sourceId} 需要登录才能搜索`;

    const btn = document.createElement("button");
    btn.className = "login-prompt-btn";
    btn.textContent = "前往登录";
    btn.addEventListener("click", () => {
      window.widgetAPI.login(sourceId);
    });

    prompt.appendChild(msg);
    prompt.appendChild(btn);
    resultsContent.appendChild(prompt);
    return;
  }

  if (data.error) {
    const errDiv = document.createElement("div");
    errDiv.className = "error-state";
    errDiv.textContent = "搜索失败: " + data.error;
    resultsContent.appendChild(errDiv);
    return;
  }

  if (data.results.length === 0) {
    resultsContent.innerHTML =
      '<div class="empty-state">该来源无结果</div>';
    return;
  }

  data.results.forEach((result) => {
    const item = document.createElement("div");
    item.className = "result-item";

    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = result.title;

    const url = document.createElement("div");
    url.className = "result-url";
    url.textContent = result.url;

    const snippet = document.createElement("div");
    snippet.className = "result-snippet";
    snippet.textContent = result.snippet;

    item.appendChild(title);
    item.appendChild(url);
    if (result.snippet) item.appendChild(snippet);

    item.addEventListener("click", () => {
      window.widgetAPI.openResult(result.url);
    });

    resultsContent.appendChild(item);
  });

  // "View more in browser" footer
  const source = sources.find((s) => s.id === sourceId);
  if (source && source.webSearchUrl && lastQuery) {
    const footer = document.createElement("div");
    footer.className = "results-footer";

    const moreBtn = document.createElement("div");
    moreBtn.className = "view-more-btn";
    const totalInfo =
      data.totalCount && data.totalCount > data.results.length
        ? ` (共 ${data.totalCount.toLocaleString()} 个结果)`
        : "";
    moreBtn.textContent = `在 ${source.name} 中查看全部结果${totalInfo}`;
    moreBtn.addEventListener("click", () => {
      const url = source.webSearchUrl.replace(
        "%s",
        encodeURIComponent(lastQuery)
      );
      window.widgetAPI.openResult(url);
    });

    footer.appendChild(moreBtn);
    resultsContent.appendChild(footer);
  }
}

// ── Auth Change Handler ──────────────────────────────────────
window.widgetAPI.onAuthChanged(async (data) => {
  // Refresh auth status
  authStatus = await window.widgetAPI.getAuthStatus();
  renderSidebar(isSearching);

  // Re-search the source if we have a query and the source had needsLogin or error
  if (lastQuery && aggregateResults[data.sourceId]) {
    const prev = aggregateResults[data.sourceId];
    if (prev.needsLogin || prev.error) {
      // Re-search this single source
      try {
        const result = await window.widgetAPI.searchSingle(
          lastQuery,
          data.sourceId
        );
        aggregateResults[data.sourceId] = {
          results: result.results,
          totalCount: result.totalCount,
          error: result.error,
          needsLogin: result.needsLogin,
        };
        renderSidebar(false);
        if (activeSourceId === data.sourceId) {
          renderContent(data.sourceId);
        }
      } catch {
        // ignore
      }
    }
  }
});

// ── Widget Activation ────────────────────────────────────────
window.widgetAPI.onActivated(() => {
  // Preserve current tab state, just focus the appropriate input
  if (currentTab === "default") {
    searchInput.focus();
    searchInput.select();
  } else {
    aggregateInput.focus();
  }
});

// ── Widget Hidden ────────────────────────────────────────────
// State is preserved on hide/minimize - no reset needed

// ── Init ─────────────────────────────────────────────────────
(async function init() {
  try {
    sources = await window.widgetAPI.getSources();
  } catch {
    sources = [];
  }
  try {
    authStatus = await window.widgetAPI.getAuthStatus();
  } catch {
    authStatus = {};
  }
})();

// ── Resize Handles ──────────────────────────────────────────
document.querySelectorAll(".resize-handle").forEach((handle) => {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const cls = Array.from(handle.classList).find(
      (c) => c.startsWith("resize-") && c !== "resize-handle"
    );
    if (!cls) return;
    const direction = cls.replace("resize-", "");

    window.widgetAPI.startResize(direction, e.screenX, e.screenY);

    const onMouseMove = (ev) => {
      window.widgetAPI.resizeDrag(ev.screenX, ev.screenY);
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      window.widgetAPI.stopResize();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
});
