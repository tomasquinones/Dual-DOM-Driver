# Dual DOM Sync

A side-by-side browser comparison tool for QA testing. Control one browser window and watch your actions mirrored in real-time on another - perfect for comparing production vs staging environments.

![Dual DOM Sync](https://img.shields.io/badge/QA-Tool-blue) ![Node.js](https://img.shields.io/badge/Node.js-20+-green)

## Features

- **Side-by-side comparison** - View production and staging simultaneously
- **Synchronized interactions** - Actions on the control window mirror to the other
- **Full input support**:
  - Click and drag (map panning)
  - Scroll wheel (map zooming)
  - Text field input and selection
  - Keyboard shortcuts
- **Navigation sync** - Back, forward, and refresh buttons stay in sync
- **Cross-origin support** - Works with any two URLs via Puppeteer

## Installation

```bash
cd qa/dual-dom-sync
npm install
```

## Quick Start

```bash
# Default: ridewithgps.com (mirror) vs huh.ridewithgps.com (control)
npm start

# Custom URLs
npm start -- --mirror https://ridewithgps.com --control https://staging.ridewithgps.com
```

## Usage

```bash
npm start -- [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--mirror <url>` | `-m`, `--left` | Mirror URL (left window) | `https://ridewithgps.com` |
| `--control <url>` | `-c`, `--right` | Control URL (right window) | `https://huh.ridewithgps.com` |
| `--width <px>` | `-w` | Width of each viewport | `960` |
| `--height <px>` | | Height of each viewport | `1080` |
| `--help` | `-h` | Show help | |

### Examples

```bash
# Compare production to a staging environment
npm start -- -m https://ridewithgps.com -c https://staging.ridewithgps.com

# Compare specific pages
npm start -- -m https://ridewithgps.com/routes/12345 -c https://huh.ridewithgps.com/routes/12345

# Adjust viewport for smaller screens
npm start -- --width 800 --height 900

# Positional arguments also work (mirror first, control second)
npm start -- https://ridewithgps.com https://huh.ridewithgps.com
```

> **Note:** The `--` after `npm start` is required to pass arguments to the script.

## How It Works

1. **Two browser windows open** - Left is the "mirror" (production), right is the "control" (staging)
2. **Interact with the RIGHT window** - All your actions are captured
3. **LEFT window mirrors your actions** - Clicks, drags, typing, scrolling all sync automatically

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Screen                              │
├────────────────────────────┬────────────────────────────────────┤
│                            │                                    │
│      MIRROR (Left)         │        CONTROL (Right)             │
│                            │                                    │
│   Production environment   │    Staging environment             │
│                            │                                    │
│   ← Actions appear here    │    ★ Interact here                 │
│                            │                                    │
└────────────────────────────┴────────────────────────────────────┘
```

## Supported Interactions

| Action | How to Use |
|--------|-----------|
| **Click** | Click anywhere in the control window |
| **Drag/Pan** | Click and drag (great for maps) |
| **Zoom** | Mouse scroll wheel |
| **Type** | Click a text field and type |
| **Select text** | Click and drag in text fields |
| **Navigate** | Click links, use back/forward buttons |
| **Refresh** | Browser refresh button, F5, or Ctrl+R |
| **Keyboard** | Arrow keys, Enter, Tab, shortcuts |

## Use Cases

- **Visual regression testing** - Spot UI differences between environments
- **Feature verification** - Confirm staging changes before deploy
- **Bug reproduction** - Compare behavior between production and staging
- **Map testing** - Verify map interactions (pan, zoom) work identically
- **Form testing** - Ensure form behavior matches across environments

## Troubleshooting

### Windows don't position correctly
Puppeteer window positioning depends on your OS and display setup. The tool works best with a wide monitor (1920px+).

### Some interactions don't sync
Complex JavaScript-driven interactions may not sync perfectly. The tool captures DOM events, but some frameworks handle events differently.

### Text input issues
If text doesn't sync in a specific field, try clicking directly in the field first. React-generated IDs are handled, but some dynamic elements may need manual focus.

## Technical Details

- Built with [Puppeteer](https://pptr.dev/) for cross-origin browser control
- Captures events via injected JavaScript in the control page
- Uses Chrome DevTools Protocol (CDP) for wheel events
- Syncs navigation via `framenavigated` events

## Requirements

- Node.js 20+
- npm or yarn
- ~400MB disk space (Puppeteer downloads Chromium)
