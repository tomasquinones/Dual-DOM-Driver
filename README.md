# Dual DOM Driver

A side-by-side browser comparison tool for QA testing. Control either browser window and watch your actions mirrored in real-time on the other - perfect for comparing production vs staging environments.

![Dual DOM Driver](https://img.shields.io/badge/QA-Tool-blue) ![Node.js](https://img.shields.io/badge/Node.js-20+-green)

## Features

- **Side-by-side comparison** - View production and staging simultaneously
- **Bidirectional sync** - Control from either window, the other mirrors your actions
- **Visual pixel diff** - Highlight pixel-level differences between the two pages
- **Full input support**:
  - Click and drag (map panning)
  - Scroll wheel (map zooming)
  - Text field input and selection
  - Keyboard shortcuts
- **Navigation sync** - Back, forward, and refresh buttons stay in sync
- **Cross-origin support** - Works with any two URLs via Puppeteer

## Installation

```bash
cd dual-dom-driver
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
| `--width <px>` | `-w` | Width of each viewport | `1280` |
| `--height <px>` | | Height of each viewport | `800` |
| `--threshold <n>` | `-t` | Diff sensitivity 0-1 (higher = less sensitive) | `0.5` |
| `--help` | `-h` | Show help | |

### Examples

```bash
# Compare production to a staging environment
npm start -- -m https://ridewithgps.com -c https://staging.ridewithgps.com

# Compare specific pages
npm start -- -m https://ridewithgps.com/routes/12345 -c https://huh.ridewithgps.com/routes/12345

# Adjust viewport for smaller screens
npm start -- --width 800 --height 900

# More sensitive diff (catches smaller differences)
npm start -- --threshold 0.3

# Less sensitive diff (ignores minor rendering differences)
npm start -- --threshold 0.7

# Positional arguments also work (mirror first, control second)
npm start -- https://ridewithgps.com https://huh.ridewithgps.com
```

> **Note:** The `--` after `npm start` is required to pass arguments to the script.

## How It Works

1. **Two browser windows open** - Left is the "mirror", right is the "control"
2. **Interact with EITHER window** - All your actions are captured and synced to the other
3. **Press D to compare** - Visual diff highlights pixel-level differences

```
┌─────────────────────────────────────────────────────────────────┐
│                        Your Screen                              │
├────────────────────────────────┬────────────────────────────────┤
│                                │                                │
│        LEFT Window             │         RIGHT Window           │
│                                │                                │
│   Production environment       │    Staging environment         │
│                                │                                │
│   ★ Interact here              │    ★ Or interact here          │
│   ↔ Actions sync both ways ↔   │    ↔ Actions sync both ways ↔  │
│                                │                                │
└────────────────────────────────┴────────────────────────────────┘
```

## Supported Interactions

| Action | How to Use |
|--------|-----------|
| **Click** | Click anywhere in either window |
| **Drag/Pan** | Click and drag (great for maps) |
| **Zoom** | Mouse scroll wheel |
| **Type** | Click a text field and type |
| **Select text** | Click and drag in text fields |
| **Navigate** | Click links, use back/forward buttons |
| **Refresh** | Browser refresh button, F5, or Ctrl+R |
| **Keyboard** | Arrow keys, Enter, Tab, shortcuts |
| **Visual Diff** | Press D to run, Shift+D to clear |

## Visual Pixel Diff

Press **D** to run a visual pixel comparison between the two browser windows. This takes screenshots of both pages and highlights any pixel-level differences.

| Key | Action |
|-----|--------|
| **D** | Run visual diff comparison |
| **Shift+D** | Clear diff overlay |
| **Click badge** | Dismiss the notification |

### Diff Results

- **Green badge** - "No visual differences detected" (pages are identical)
- **Red badge** - Shows count and percentage of differing pixels
- **Red overlay** - Highlights areas where pixels differ

### Tuning Sensitivity

The `--threshold` option controls how sensitive the diff is:

- `0.1` - Very sensitive (catches subtle anti-aliasing differences)
- `0.5` - Default (balanced, ignores sub-pixel rendering noise)
- `0.9` - Very lenient (only catches major visual differences)

The diff also downscales images 2x before comparing to filter out scattered sub-pixel noise from font rendering differences.

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

### Diff shows many false positives
Try increasing the threshold: `npm start -- --threshold 0.7`. Sub-pixel font rendering can cause scattered differences between browser instances.

## Technical Details

- Built with [Puppeteer](https://pptr.dev/) for cross-origin browser control
- Uses [pixelmatch](https://github.com/mapbox/pixelmatch) for visual diff comparison
- Captures events via injected JavaScript in both pages
- Uses Chrome DevTools Protocol (CDP) for wheel events
- Syncs navigation via `framenavigated` events
- Bidirectional sync with loop prevention

## Requirements

- Node.js 20+
- npm or yarn
- ~400MB disk space (Puppeteer downloads Chromium)
