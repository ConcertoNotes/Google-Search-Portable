# Google Search Portable

A lightweight desktop search widget built with Electron. Press a global hotkey to summon a floating search bar with two modes: quick Google search and multi-source aggregate search.

## Features

- **Global Hotkey** - `Ctrl+Space` (fallback `Alt+Space`) to toggle the widget
- **Default Search** - Google-style search bar, results open directly in Chrome
- **Aggregate Search** - Search across multiple sources simultaneously:
  - GitHub (repositories & issues)
  - Stack Overflow
  - Hacker News
  - Reddit
  - Linux.do
  - X (Twitter, requires login)
- **Streaming Results** - Aggregate results appear as each source responds
- **Login Management** - Per-source login/logout with persistent sessions
- **Transparent Frameless Window** - Minimal floating UI with custom resize handles
- **Chrome Integration** - Auto-detects Chrome and opens results in it, falls back to default browser
- **Auto-start** - Launches on Windows login
- **Single Instance** - Prevents duplicate processes

## Preview

The widget has two tabs:

- **Default Search** - A centered Google-style search bar for quick searches
- **Aggregate Search** - A search bar with sidebar showing results from 6 sources, with result counts and login status

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- npm

### Install

```bash
git clone git@github.com:ConcertoNotes/Google-Search-Portable.git
cd Google-Search-Portable
npm install
```

### Run

```bash
npx electron .
```

### Build

```bash
npm run build
```

Outputs a Windows NSIS installer to the `dist/` folder.

## Usage

| Shortcut | Action |
|----------|--------|
| `Ctrl+Space` / `Alt+Space` | Toggle widget |
| `Enter` | Search (default mode opens Google, aggregate mode queries all sources) |
| `Escape` | Hide widget |

In aggregate mode, click a source in the sidebar to view its results. Click the login button next to a source to authenticate for that platform.

## Project Structure

```
├── index.html      # UI markup (default + aggregate views)
├── styles.css      # Styling
├── main.js         # Electron main process, search APIs, auth management
├── renderer.js     # Renderer process, UI logic, result rendering
├── preload.js      # Context bridge (IPC security layer)
└── package.json    # Dependencies & build config
```

## License

MIT
