#!/usr/bin/env node

import puppeteer from 'puppeteer';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    leftUrl: 'https://ridewithgps.com',
    rightUrl: 'https://huh.ridewithgps.com',
    width: 960,
    height: 1080,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      console.log(`
Dual DOM Driver - Side-by-side browser comparison tool

Usage:
  npm start -- [options]
  node sync.js [options]

Options:
  --mirror, -m <url>   Mirror URL (left side, production)
  --control, -c <url>  Control URL (right side, staging)
  --left <url>         Alias for --mirror
  --right <url>        Alias for --control
  --width, -w <px>     Width of each viewport (default: 960)
  --height <px>        Height of each viewport (default: 1080)
  --help, -h           Show this help

Examples:
  npm start -- --mirror https://ridewithgps.com --control https://staging.ridewithgps.com
  npm start -- -m https://ridewithgps.com -c https://huh.ridewithgps.com
  npm start -- --left https://ridewithgps.com --right https://beta.ridewithgps.com
  node sync.js https://ridewithgps.com https://huh.ridewithgps.com
`);
      process.exit(0);
    }

    if (arg === '--mirror' || arg === '-m' || arg === '--left') {
      config.leftUrl = args[++i];
    } else if (arg === '--control' || arg === '-c' || arg === '--right') {
      config.rightUrl = args[++i];
    } else if (arg === '--width' || arg === '-w') {
      config.width = parseInt(args[++i], 10);
    } else if (arg === '--height') {
      config.height = parseInt(args[++i], 10);
    } else if (!arg.startsWith('-')) {
      // Positional args: first is left/mirror, second is right/control
      if (!config._posCount) config._posCount = 0;
      if (config._posCount === 0) config.leftUrl = arg;
      else if (config._posCount === 1) config.rightUrl = arg;
      config._posCount++;
    }
  }

  delete config._posCount;
  return config;
}

const config = parseArgs();

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                   Dual DOM Driver Tool                        ║
╠═══════════════════════════════════════════════════════════════╣
║  LEFT  (mirror):  ${config.leftUrl.padEnd(42)} ║
║  RIGHT (control): ${config.rightUrl.padEnd(42)} ║
╠═══════════════════════════════════════════════════════════════╣
║  Interact with the RIGHT window - LEFT will mirror actions    ║
║  - Click, drag (pan), scroll wheel (zoom) all supported       ║
║  Press Ctrl+C to exit                                         ║
╚═══════════════════════════════════════════════════════════════╝
`);

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      `--window-size=${config.width * 2},${config.height}`,
      '--window-position=0,0',
    ],
  });

  // Create two pages
  const [leftPage, rightPage] = await Promise.all([
    browser.newPage(),
    browser.newPage(),
  ]);

  // Position windows side by side
  const leftSession = await leftPage.createCDPSession();
  const rightSession = await rightPage.createCDPSession();

  await leftSession.send('Browser.setWindowBounds', {
    windowId: 1,
    bounds: { left: 0, top: 0, width: config.width, height: config.height },
  }).catch(() => {}); // Ignore if not supported

  await rightSession.send('Browser.setWindowBounds', {
    windowId: 2,
    bounds: { left: config.width, top: 0, width: config.width, height: config.height },
  }).catch(() => {});

  // Navigate to initial URLs
  await Promise.all([
    leftPage.goto(config.leftUrl, { waitUntil: 'domcontentloaded' }),
    rightPage.goto(config.rightUrl, { waitUntil: 'domcontentloaded' }),
  ]);

  // Inject event capture script into the control page (right)
  await rightPage.exposeFunction('syncToLeft', async (event) => {
    try {
      switch (event.type) {
        case 'mousedown':
          await leftPage.mouse.move(event.x, event.y);
          await leftPage.mouse.down({ button: event.button });
          break;

        case 'mousemove':
          if (event.buttons > 0) {
            await leftPage.mouse.move(event.x, event.y);
          }
          break;

        case 'mouseup':
          await leftPage.mouse.up({ button: event.button });
          break;

        case 'wheel':
          // Use CDP for wheel events (more reliable for maps)
          const client = await leftPage.createCDPSession();
          await client.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: event.x,
            y: event.y,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
          });
          break;

        case 'scroll':
          await leftPage.evaluate(({ x, y }) => {
            window.scrollTo(x, y);
          }, { x: event.scrollX, y: event.scrollY });
          break;

        case 'input':
          // Find element by selector and set value
          await leftPage.evaluate(({ selector, value }) => {
            const el = document.querySelector(selector);
            if (el) {
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, { selector: event.selector, value: event.value });
          break;

        case 'focus':
          // Focus the same element on the left page
          await leftPage.evaluate(({ selector }) => {
            const el = document.querySelector(selector);
            if (el) el.focus();
          }, { selector: event.selector });
          break;

        case 'goBack':
          await leftPage.goBack().catch(() => {});
          break;

        case 'goForward':
          await leftPage.goForward().catch(() => {});
          break;

        case 'refresh':
          await leftPage.reload().catch(() => {});
          break;

        case 'keydown':
          await leftPage.keyboard.down(event.key);
          break;

        case 'keyup':
          await leftPage.keyboard.up(event.key);
          break;

        case 'keypress':
          // For printable characters, use type() for better compatibility
          if (event.char && event.char.length === 1) {
            await leftPage.keyboard.type(event.char);
          }
          break;

        case 'selection':
          // Sync text selection in input fields
          await leftPage.evaluate(({ selector, start, end }) => {
            const el = document.querySelector(selector);
            if (el && el.setSelectionRange) {
              el.focus();
              el.setSelectionRange(start, end);
            }
          }, { selector: event.selector, start: event.start, end: event.end });
          break;

        case 'navigate':
          // Sync navigation by converting URLs
          const leftUrl = event.url.replace(config.rightUrl, config.leftUrl);
          await leftPage.goto(leftUrl, { waitUntil: 'domcontentloaded' });
          break;
      }
    } catch (err) {
      console.log(`[sync error] ${event.type}:`, err.message);
    }
  });

  // Inject the event listener script
  const injectScript = `
    (function() {
      if (window.__dualDomSyncInjected) return;
      window.__dualDomSyncInjected = true;

      // Capture mousedown (start of click or drag)
      document.addEventListener('mousedown', (e) => {
        window.syncToLeft({
          type: 'mousedown',
          x: e.clientX,
          y: e.clientY,
          button: e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle',
        });
      }, true);

      // Capture mousemove (during drag)
      document.addEventListener('mousemove', (e) => {
        if (e.buttons > 0) {
          window.syncToLeft({
            type: 'mousemove',
            x: e.clientX,
            y: e.clientY,
            buttons: e.buttons,
          });
        }
      }, true);

      // Capture mouseup (end of click or drag)
      document.addEventListener('mouseup', (e) => {
        window.syncToLeft({
          type: 'mouseup',
          x: e.clientX,
          y: e.clientY,
          button: e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle',
        });
      }, true);

      // Note: click events are handled by mousedown + mouseup sequence
      // No separate click handler needed (would cause double-clicks)

      // Capture wheel events (for map zoom)
      document.addEventListener('wheel', (e) => {
        window.syncToLeft({
          type: 'wheel',
          x: e.clientX,
          y: e.clientY,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
        });
      }, { capture: true, passive: true });

      // Capture page scroll
      let scrollTimeout;
      window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          window.syncToLeft({
            type: 'scroll',
            scrollX: window.scrollX,
            scrollY: window.scrollY,
          });
        }, 50);
      }, true);

      // Capture input changes (fallback sync for paste, autocomplete, etc.)
      document.addEventListener('input', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
          window.syncToLeft({
            type: 'input',
            selector: getSelector(e.target),
            value: e.target.value,
          });
        }
      }, true);

      // Escape special CSS selector characters
      function escapeCSS(str) {
        return CSS.escape(str);
      }

      // Build a selector for an element
      function getSelector(el) {
        // Prefer name attribute for form fields (most reliable)
        if (el.name) {
          return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
        }
        // Use ID if present, but escape special characters
        if (el.id) {
          return '#' + escapeCSS(el.id);
        }
        // Fall back to tag + class
        let selector = el.tagName.toLowerCase();
        if (el.className && typeof el.className === 'string') {
          const classes = el.className.trim().split(/\\s+/).filter(c => c);
          if (classes.length > 0) {
            selector += '.' + classes.map(escapeCSS).join('.');
          }
        }
        // Add nth-of-type if needed for uniqueness
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length > 1) {
            const idx = Array.from(matches).indexOf(el);
            if (idx >= 0) selector += ':nth-of-type(' + (idx + 1) + ')';
          }
        } catch (e) {
          // If selector is invalid, try a different approach
        }
        return selector;
      }

      // Track focused input element
      let focusedInput = null;

      // Capture focus on text fields
      document.addEventListener('focus', (e) => {
        const el = e.target;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          focusedInput = el;
          window.syncToLeft({
            type: 'focus',
            selector: getSelector(el),
          });
        }
      }, true);

      // Capture blur to clear focused input tracking
      document.addEventListener('blur', (e) => {
        if (e.target === focusedInput) {
          focusedInput = null;
        }
      }, true);

      // Capture keyboard - works everywhere now including text fields
      document.addEventListener('keydown', (e) => {
        // Skip if it's a modifier key alone
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
          window.syncToLeft({ type: 'keydown', key: e.key });
          return;
        }

        // For text input, send keydown for special keys only
        if (focusedInput) {
          // Special keys that need keydown (arrows, backspace, delete, enter, tab, etc.)
          const specialKeys = ['Backspace', 'Delete', 'Enter', 'Tab', 'Escape',
            'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
            'Home', 'End', 'PageUp', 'PageDown'];
          if (specialKeys.includes(e.key) || e.ctrlKey || e.metaKey) {
            window.syncToLeft({ type: 'keydown', key: e.key });
          }
          // Printable chars handled by keypress
        } else {
          // Outside text fields, send all keydowns
          window.syncToLeft({ type: 'keydown', key: e.key });
        }
      }, true);

      // Capture keypress for printable characters in text fields
      document.addEventListener('keypress', (e) => {
        if (focusedInput && e.key.length === 1) {
          window.syncToLeft({ type: 'keypress', char: e.key });
        }
      }, true);

      document.addEventListener('keyup', (e) => {
        // Send keyup for modifier keys
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
          window.syncToLeft({ type: 'keyup', key: e.key });
        } else if (!focusedInput) {
          window.syncToLeft({ type: 'keyup', key: e.key });
        }
      }, true);

      // Capture text selection changes in input fields
      document.addEventListener('select', (e) => {
        const el = e.target;
        if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
            typeof el.selectionStart === 'number') {
          window.syncToLeft({
            type: 'selection',
            selector: getSelector(el),
            start: el.selectionStart,
            end: el.selectionEnd,
          });
        }
      }, true);

      // Capture browser back/forward via popstate
      window.addEventListener('popstate', () => {
        // The framenavigated event will handle the actual navigation sync
        console.log('[Dual DOM Driver] History navigation detected');
      });

      // Capture keyboard shortcuts for navigation
      document.addEventListener('keydown', (e) => {
        // Refresh: F5 or Ctrl/Cmd+R
        if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && e.key === 'r')) {
          window.syncToLeft({ type: 'refresh' });
        }
        // Back: Alt+Left or Backspace (when not in input)
        if (e.altKey && e.key === 'ArrowLeft') {
          window.syncToLeft({ type: 'goBack' });
        }
        // Forward: Alt+Right
        if (e.altKey && e.key === 'ArrowRight') {
          window.syncToLeft({ type: 'goForward' });
        }
      }, true);

      console.log('[Dual DOM Driver] Event capture active - click, drag, wheel, text input, navigation supported');
    })();
  `;

  await rightPage.evaluate(injectScript);

  // Track navigation to sync back/forward/refresh
  let isNavigating = false;
  const rightOrigin = new URL(config.rightUrl).origin;
  const leftOrigin = new URL(config.leftUrl).origin;

  // Sync navigation when right page navigates (handles back/forward/refresh/links)
  rightPage.on('framenavigated', async (frame) => {
    // Only handle main frame
    if (frame !== rightPage.mainFrame()) return;
    if (isNavigating) return;

    try {
      isNavigating = true;
      const rightUrl = frame.url();
      const leftUrl = rightUrl.replace(rightOrigin, leftOrigin);

      if (leftPage.url() !== leftUrl) {
        console.log(`[sync] Navigating left to: ${leftUrl}`);
        await leftPage.goto(leftUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    } catch (err) {
      // Page might be navigating
    } finally {
      isNavigating = false;
    }
  });

  // Re-inject script on navigation
  rightPage.on('domcontentloaded', async () => {
    try {
      await rightPage.evaluate(injectScript);
    } catch (err) {
      // Page might be navigating
    }
  });

  // Handle browser close
  browser.on('disconnected', () => {
    console.log('\nBrowser closed. Exiting...');
    process.exit(0);
  });

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await browser.close();
    process.exit(0);
  });
}

main().catch(console.error);
