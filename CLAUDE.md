# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dual DOM Driver is a QA testing tool that opens two browser windows side-by-side (production vs staging) and mirrors interactions from the control window (right) to the mirror window (left) in real-time. Built with Puppeteer for cross-origin browser automation.

## Commands

```bash
npm start                                    # Default URLs (ridewithgps.com vs huh.ridewithgps.com)
npm start -- -m <url> -c <url>               # Custom mirror (left) and control (right) URLs
npm start -- --width 800 --height 900        # Custom viewport dimensions
npm start -- --no-diff                       # Disable visual pixel diff
npm start -- --help                          # Show help
```

Note: The `--` after `npm start` is required to pass arguments to the script.

## Architecture

### Single-File Design
The entire implementation is in `sync.js` (~490 lines). There's also an `index.html` browser-based fallback with iframe approach, but it has same-origin limitations.

### Event Flow
1. **Either page**: User can interact with either the left or right window
2. **Injected script**: Captures DOM events via document-level listeners with `{ capture: true }`
3. **`syncToOther()` bridge**: Puppeteer-exposed function sends events to Node.js
4. **Other page**: Puppeteer APIs replay the events on the opposite page

### Key Components in sync.js

- **`parseArgs()`** (lines 6-63): CLI argument parsing with named flags and positional args
- **`syncToLeft()` handler** (lines 117-220): Switch statement routing 13 event types to appropriate Puppeteer actions
- **Injected script** (lines 223-435): IIFE with double-injection guard (`window.__dualDomSyncInjected`), event listeners, and element selector builder
- **Navigation sync** (lines 444-464): `framenavigated` event handler with origin replacement and navigation lock

### Element Selector Strategy
The `getSelector()` function builds CSS selectors with priority: `name` attribute → `id` (escaped) → tag+classes → nth-of-type fallback.

### Event Types Supported
Mouse (down/move/up), wheel (via CDP), scroll (debounced 50ms), input/focus/blur, keyboard (with special key handling), text selection, navigation (back/forward/refresh).

### Visual Pixel Diff
**Enabled by default** - takes screenshots of both pages and highlights pixel-level differences. Works reliably with React apps and dynamic DOM structures. Use `--no-diff` flag to start with it disabled.
- **D**: Run visual diff comparison
- **Shift+D**: Clear diff overlay

The diff overlay shows:
- **Red pixels**: Areas where the two pages differ visually
- **Green badge**: "No visual differences detected" when pages are identical
- **Red badge**: Shows count and percentage of differing pixels

### CDP Usage
Wheel events use Chrome DevTools Protocol directly (`Input.dispatchMouseEvent` with `mouseWheel` type) for reliable map zoom behavior.
