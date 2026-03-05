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
║  Press DELETE to toggle style diff highlighting               ║
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

  // Style properties to compare for diff highlighting
  const diffStyleProperties = [
    // Layout
    'width', 'height', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'display', 'position', 'top', 'right', 'bottom', 'left',
    'flexDirection', 'justifyContent', 'alignItems', 'flexWrap', 'gap',
    // Typography
    'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'textAlign',
    'letterSpacing', 'textTransform', 'textDecoration',
  ];

  // Expose function to get element info from mirror (left/production) page
  await rightPage.exposeFunction('getMirrorElementInfo', async (selector) => {
    try {
      const result = await leftPage.evaluate((sel, props) => {
        const el = document.querySelector(sel);
        if (!el) return { exists: false, styles: null };

        const computed = window.getComputedStyle(el);
        const styles = {};
        for (const prop of props) {
          styles[prop] = computed[prop];
        }
        return { exists: true, styles };
      }, selector, diffStyleProperties);
      return result;
    } catch (err) {
      return { exists: false, styles: null, error: err.message };
    }
  });

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

      // Detect clicks on links to distinguish from address bar navigation
      document.addEventListener('click', (e) => {
        // Check if click was on a link or inside a link
        let target = e.target;
        while (target && target !== document.body) {
          if (target.tagName === 'A' && target.href) {
            // Signal that a link navigation is expected
            window.expectLinkNavigation();
            break;
          }
          target = target.parentElement;
        }
      }, true);

      // Detect form submissions (which can also navigate)
      document.addEventListener('submit', () => {
        window.expectLinkNavigation();
      }, true);

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
        // Signal that navigation is expected (from back/forward buttons)
        window.expectLinkNavigation();
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

      // ============ STYLE DIFF HIGHLIGHTING ============
      // Toggle with Delete key - highlights elements with style differences from production

      let diffModeEnabled = false;
      const DIFF_OUTLINE_STYLE = '3px solid red';
      const DIFF_ATTR = 'data-dual-dom-diff';

      // Style properties to compare (must match server-side list)
      const diffStyleProperties = [
        'width', 'height', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'display', 'position', 'top', 'right', 'bottom', 'left',
        'flexDirection', 'justifyContent', 'alignItems', 'flexWrap', 'gap',
        'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'textAlign',
        'letterSpacing', 'textTransform', 'textDecoration',
      ];

      // Get a unique selector path for an element
      function getUniquePath(el) {
        if (el === document.body) return 'body';
        if (el === document.documentElement) return 'html';

        const parts = [];
        let current = el;

        while (current && current !== document.body && current !== document.documentElement) {
          let selector = current.tagName.toLowerCase();

          if (current.id) {
            selector = '#' + CSS.escape(current.id);
            parts.unshift(selector);
            break;
          } else {
            // Add nth-child for uniqueness
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
              if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += ':nth-of-type(' + index + ')';
              }
            }
            parts.unshift(selector);
          }

          current = current.parentElement;
        }

        return 'body > ' + parts.join(' > ');
      }

      // Compare styles and return true if different
      function stylesAreDifferent(localStyles, mirrorStyles) {
        for (const prop of diffStyleProperties) {
          if (localStyles[prop] !== mirrorStyles[prop]) {
            return true;
          }
        }
        return false;
      }

      // Clear all diff highlights
      function clearDiffHighlights() {
        const highlighted = document.querySelectorAll('[' + DIFF_ATTR + ']');
        highlighted.forEach(el => {
          el.style.outline = el.getAttribute(DIFF_ATTR) || '';
          el.removeAttribute(DIFF_ATTR);
        });
      }

      // Run diff comparison on visible elements
      async function runDiffComparison() {
        console.log('[Dual DOM Driver] Running style diff comparison...');

        // Get all elements in the viewport (limit to reasonable set)
        const allElements = document.querySelectorAll('body *');
        let diffCount = 0;
        let newCount = 0;

        for (const el of allElements) {
          // Skip script, style, and hidden elements
          if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') continue;
          if (el.offsetParent === null && el.tagName !== 'BODY') continue; // hidden

          const selector = getUniquePath(el);
          if (!selector) continue;

          try {
            const mirrorInfo = await window.getMirrorElementInfo(selector);
            const localStyles = window.getComputedStyle(el);

            // Store original outline so we can restore it
            if (!el.hasAttribute(DIFF_ATTR)) {
              el.setAttribute(DIFF_ATTR, el.style.outline || '');
            }

            if (!mirrorInfo.exists) {
              // Element doesn't exist in production - new element
              el.style.outline = '3px dashed orange';
              newCount++;
            } else if (stylesAreDifferent(localStyles, mirrorInfo.styles)) {
              // Styles are different
              el.style.outline = DIFF_OUTLINE_STYLE;
              diffCount++;
            } else {
              // No difference - restore original
              el.style.outline = el.getAttribute(DIFF_ATTR) || '';
              el.removeAttribute(DIFF_ATTR);
            }
          } catch (err) {
            // Skip elements that cause errors
          }
        }

        console.log('[Dual DOM Driver] Diff complete: ' + diffCount + ' style differences, ' + newCount + ' new elements');
      }

      // Toggle diff mode with Delete key
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' && !focusedInput) {
          e.preventDefault();
          diffModeEnabled = !diffModeEnabled;

          if (diffModeEnabled) {
            console.log('[Dual DOM Driver] Diff mode ENABLED - highlighting style differences');
            runDiffComparison();
          } else {
            console.log('[Dual DOM Driver] Diff mode DISABLED');
            clearDiffHighlights();
          }
        }
      }, true);

      console.log('[Dual DOM Driver] Event capture active - click, drag, wheel, text input, navigation supported');
      console.log('[Dual DOM Driver] Press DELETE to toggle style diff highlighting');
    })();
  `;

  await rightPage.evaluate(injectScript);

  // Track navigation to sync back/forward/refresh
  let isNavigating = false;
  let linkClickTime = 0; // Timestamp of last link click (for filtering address bar navigations)
  const LINK_NAV_WINDOW = 3000; // 3 second window to consider navigation as link-triggered
  const rightOrigin = new URL(config.rightUrl).origin;
  const leftOrigin = new URL(config.leftUrl).origin;

  // Expose function to signal that a link was clicked (navigation expected)
  await rightPage.exposeFunction('expectLinkNavigation', () => {
    linkClickTime = Date.now();
  });

  // Sync navigation when right page navigates (only for link clicks, not address bar)
  rightPage.on('framenavigated', async (frame) => {
    // Only handle main frame
    if (frame !== rightPage.mainFrame()) return;
    if (isNavigating) return;

    // Only sync if navigation was triggered by a link click (not address bar)
    const timeSinceClick = Date.now() - linkClickTime;
    if (timeSinceClick > LINK_NAV_WINDOW) {
      console.log(`[sync] Ignoring address bar navigation (not syncing)`);
      return;
    }

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
