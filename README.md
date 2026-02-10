# Google Search Portable

A lightweight desktop search widget built with Electron. Press a global hotkey to instantly summon a Google search bar, type your query, and open results directly in Chrome.

## Features

- **Global Hotkey** - `Ctrl+Space` (fallback `Alt+Space`) to toggle the widget
- **Transparent Frameless Window** - Minimal, floating search bar with no window chrome
- **Chrome Integration** - Automatically detects and opens results in Google Chrome, falls back to default browser
- **Auto-start** - Launches on Windows login
- **Single Instance** - Prevents duplicate processes

## Preview

The widget appears as a floating Google-style search bar centered on your screen.

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
npm run dist
```

Outputs a Windows NSIS installer to the `dist/` folder.

## Usage

| Shortcut | Action |
|----------|--------|
| `Ctrl+Space` / `Alt+Space` | Show search bar |
| `Enter` | Search in Google |
| `Escape` | Hide widget |

Click anywhere outside the widget to dismiss it.

## Project Structure

```
├── index.html      # UI markup
├── styles.css      # Styling
├── main.js         # Electron main process
├── renderer.js     # Renderer process logic
├── preload.js      # Context bridge
└── package.json    # Dependencies & build config
```

## License

MIT
