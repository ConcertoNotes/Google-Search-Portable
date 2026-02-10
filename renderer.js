const input = document.getElementById("search-input");

// Submit search on Enter
input.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const q = input.value.trim();
    if (!q) return;
    try {
      const result = await window.widgetAPI.submitSearch(q);
      if (result && result.ok) {
        input.value = "";
      }
    } catch {
      // IPC failure – silently ignore, widget stays open for retry
    }
  }
  if (e.key === "Escape") {
    window.widgetAPI.hideWidget();
  }
});

// Re-focus input when widget is activated via hotkey
window.widgetAPI.onActivated(() => {
  input.focus();
  input.select();
});
