# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dual DOM Driver is a QA testing tool that opens two browser windows side-by-side (production vs staging) and mirrors interactions from the control window (right) to the mirror window (left) in real-time. Built with Puppeteer for cross-origin browser automation.

## Commands

```bash
npm start                                    # Default URLs (ridewithgps.com vs huh.ridewithgps.com)
npm start -- -m <url> -c <url>               # Custom mirror (left) and control (right) URLs
npm start -- --width 800 --height 900        # Custom viewport dimensions
npm start -- --help                          # Show help
```

Note: The `--` after `npm start` is required to pass arguments to the script.

## Architecture

### Single-File Design
The entire implementation is in `sync.js` (~490 lines). There's also an `index.html` browser-based fallback with iframe approach, but it has same-origin limitations.

### Event Flow
1. **Control page (right)**: User interacts here
2. **Injected script**: Captures DOM events via document-level listeners with `{ capture: true }`
3. **`syncToLeft()` bridge**: Puppeteer-exposed function sends events to Node.js
4. **Mirror page (left)**: Puppeteer APIs replay the events

### Key Components in sync.js

- **`parseArgs()`** (lines 6-63): CLI argument parsing with named flags and positional args
- **`syncToLeft()` handler** (lines 117-220): Switch statement routing 13 event types to appropriate Puppeteer actions
- **Injected script** (lines 223-435): IIFE with double-injection guard (`window.__dualDomSyncInjected`), event listeners, and element selector builder
- **Navigation sync** (lines 444-464): `framenavigated` event handler with origin replacement and navigation lock

### Element Selector Strategy
The `getSelector()` function builds CSS selectors with priority: `name` attribute → `id` (escaped) → tag+classes → nth-of-type fallback.

### Event Types Supported
Mouse (down/move/up), wheel (via CDP), scroll (debounced 50ms), input/focus/blur, keyboard (with special key handling), text selection, navigation (back/forward/refresh).

### Style Diff Highlighting
Press **Delete** to toggle style diff mode. Compares computed styles between control (staging) and mirror (production):
- **Red solid outline**: Element exists on both but has style differences
- **Orange dashed outline**: Element is new (exists on control but not production)

Compared properties:
- Layout: width, height, padding, margin, display, position, flex properties
- Typography: font-size, font-weight, font-family, line-height, text-align, letter-spacing, text-transform, text-decoration

### CDP Usage
Wheel events use Chrome DevTools Protocol directly (`Input.dispatchMouseEvent` with `mouseWheel` type) for reliable map zoom behavior.
