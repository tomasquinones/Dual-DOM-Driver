#!/usr/bin/env node

import puppeteer from 'puppeteer';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    leftUrl: 'https://ridewithgps.com',
    rightUrl: 'https://huh.ridewithgps.com',
    width: 960,
    height: 1080,
    diffThreshold: 0.5,
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
  --threshold, -t <n>  Diff sensitivity 0-1 (default: 0.5, higher = less sensitive)
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
    } else if (arg === '--threshold' || arg === '-t') {
      config.diffThreshold = parseFloat(args[++i]);
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
║  Interact with EITHER window - the other will mirror actions  ║
║  Press D to run visual diff | Shift+D to clear overlay        ║
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

  // Visual diff function - compares screenshots pixel by pixel
  async function runVisualDiff() {
    console.log('[diff] Taking screenshots...');

    // Hide any existing diff overlay on the right page before taking screenshot
    await rightPage.evaluate(() => {
      const overlay = document.getElementById('dual-dom-diff-overlay');
      if (overlay) overlay.style.display = 'none';
      const loading = document.getElementById('dual-dom-diff-loading');
      if (loading) loading.style.display = 'none';
    });

    // Ensure both pages are at the same scroll position
    const scrollPos = await rightPage.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY
    }));
    await leftPage.evaluate(({ x, y }) => window.scrollTo(x, y), scrollPos);

    // Small delay for scroll to settle
    await new Promise(r => setTimeout(r, 200));

    // Take screenshots of both pages
    const [leftBuffer, rightBuffer] = await Promise.all([
      leftPage.screenshot({ encoding: 'binary', type: 'png' }),
      rightPage.screenshot({ encoding: 'binary', type: 'png' }),
    ]);

    // Re-show the overlay container (it will be updated with new results)
    await rightPage.evaluate(() => {
      const overlay = document.getElementById('dual-dom-diff-overlay');
      if (overlay) overlay.style.display = '';
    });

    // Parse PNG data
    const leftPng = PNG.sync.read(leftBuffer);
    const rightPng = PNG.sync.read(rightBuffer);

    // Use the smaller dimensions (crop to common size)
    const fullWidth = Math.min(leftPng.width, rightPng.width);
    const fullHeight = Math.min(leftPng.height, rightPng.height);

    console.log(`[diff] Left: ${leftPng.width}x${leftPng.height}, Right: ${rightPng.width}x${rightPng.height}, Using: ${fullWidth}x${fullHeight}`);

    // Downscale factor - averages out sub-pixel rendering differences
    const scale = 2;
    const width = Math.floor(fullWidth / scale);
    const height = Math.floor(fullHeight / scale);

    // Helper to downscale PNG data (averages pixels in each block)
    function downscalePngData(png, srcWidth, srcHeight, targetWidth, targetHeight, scale) {
      const result = new Uint8Array(targetWidth * targetHeight * 4);

      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          let r = 0, g = 0, b = 0, a = 0;
          let count = 0;

          // Average the pixels in this block
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const srcX = x * scale + dx;
              const srcY = y * scale + dy;
              if (srcX < srcWidth && srcY < srcHeight) {
                const srcIdx = (srcY * png.width + srcX) * 4;
                r += png.data[srcIdx];
                g += png.data[srcIdx + 1];
                b += png.data[srcIdx + 2];
                a += png.data[srcIdx + 3];
                count++;
              }
            }
          }

          const dstIdx = (y * targetWidth + x) * 4;
          result[dstIdx] = Math.round(r / count);
          result[dstIdx + 1] = Math.round(g / count);
          result[dstIdx + 2] = Math.round(b / count);
          result[dstIdx + 3] = Math.round(a / count);
        }
      }
      return result;
    }

    // Downscale both images (averages out sub-pixel differences)
    const leftData = downscalePngData(leftPng, fullWidth, fullHeight, width, height, scale);
    const rightData = downscalePngData(rightPng, fullWidth, fullHeight, width, height, scale);

    // Create diff image
    const diffPng = new PNG({ width, height });

    // Compare pixels - returns number of different pixels
    // threshold: higher = less sensitive (0.5 handles sub-pixel rendering differences)
    // includeAA: false = ignore anti-aliasing differences
    const numDiffPixels = pixelmatch(
      leftData,
      rightData,
      diffPng.data,
      width,
      height,
      { threshold: config.diffThreshold, includeAA: false, alpha: 0.3, diffColor: [255, 0, 0] }
    );

    const totalPixels = width * height;
    const diffPercent = ((numDiffPixels / totalPixels) * 100).toFixed(2);

    console.log(`[diff] Comparison complete: ${numDiffPixels.toLocaleString()} different pixels (${diffPercent}%)`);

    // Convert diff image to base64 data URL
    const diffBuffer = PNG.sync.write(diffPng);
    const diffDataUrl = 'data:image/png;base64,' + diffBuffer.toString('base64');

    return {
      diffDataUrl,
      numDiffPixels,
      diffPercent,
      width: fullWidth,  // Return full size for overlay positioning
      height: fullHeight,
      scale
    };
  }

  // Expose visual diff function to browser (both pages)
  const exposeDiffFunction = async (page) => {
    await page.exposeFunction('runVisualDiff', async () => {
      try {
        return await runVisualDiff();
      } catch (err) {
        console.error('[diff error]', err.message);
        return { error: err.message };
      }
    });
  };
  await exposeDiffFunction(rightPage);
  await exposeDiffFunction(leftPage);

  // Sync lock to prevent infinite loops
  let syncLock = false;

  // Create sync handler for a target page
  function createSyncHandler(targetPage, sourceUrl, targetUrl) {
    return async (event) => {
      if (syncLock) return; // Prevent sync loops
      syncLock = true;

      try {
        switch (event.type) {
          case 'mousedown':
            await targetPage.mouse.move(event.x, event.y);
            await targetPage.mouse.down({ button: event.button });
            break;

          case 'mousemove':
            if (event.buttons > 0) {
              await targetPage.mouse.move(event.x, event.y);
            }
            break;

          case 'mouseup':
            await targetPage.mouse.up({ button: event.button });
            break;

          case 'wheel':
            // Use CDP for wheel events (more reliable for maps)
            const client = await targetPage.createCDPSession();
            await client.send('Input.dispatchMouseEvent', {
              type: 'mouseWheel',
              x: event.x,
              y: event.y,
              deltaX: event.deltaX,
              deltaY: event.deltaY,
            });
            break;

          case 'scroll':
            await targetPage.evaluate(({ x, y }) => {
              window.scrollTo(x, y);
            }, { x: event.scrollX, y: event.scrollY });
            break;

          case 'input':
            await targetPage.evaluate(({ selector, value }) => {
              const el = document.querySelector(selector);
              if (el) {
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, { selector: event.selector, value: event.value });
            break;

          case 'focus':
            await targetPage.evaluate(({ selector }) => {
              const el = document.querySelector(selector);
              if (el) el.focus();
            }, { selector: event.selector });
            break;

          case 'goBack':
            await targetPage.goBack().catch(() => {});
            break;

          case 'goForward':
            await targetPage.goForward().catch(() => {});
            break;

          case 'refresh':
            await targetPage.reload().catch(() => {});
            break;

          case 'keydown':
            await targetPage.keyboard.down(event.key);
            break;

          case 'keyup':
            await targetPage.keyboard.up(event.key);
            break;

          case 'keypress':
            if (event.char && event.char.length === 1) {
              await targetPage.keyboard.type(event.char);
            }
            break;

          case 'selection':
            await targetPage.evaluate(({ selector, start, end }) => {
              const el = document.querySelector(selector);
              if (el && el.setSelectionRange) {
                el.focus();
                el.setSelectionRange(start, end);
              }
            }, { selector: event.selector, start: event.start, end: event.end });
            break;

          case 'navigate':
            const newUrl = event.url.replace(sourceUrl, targetUrl);
            await targetPage.goto(newUrl, { waitUntil: 'domcontentloaded' });
            break;
        }
      } catch (err) {
        console.log(`[sync error] ${event.type}:`, err.message);
      } finally {
        // Release lock immediately - synthetic events are already blocked
        syncLock = false;
      }
    };
  }

  // Expose sync functions for both directions
  await rightPage.exposeFunction('syncToOther', createSyncHandler(leftPage, config.rightUrl, config.leftUrl));
  await leftPage.exposeFunction('syncToOther', createSyncHandler(rightPage, config.leftUrl, config.rightUrl));

  // Inject the event listener script
  const injectScript = `
    (function() {
      if (window.__dualDomSyncInjected) return;
      window.__dualDomSyncInjected = true;

      // Capture mousedown (start of click or drag)
      document.addEventListener('mousedown', (e) => {
        window.syncToOther({
          type: 'mousedown',
          x: e.clientX,
          y: e.clientY,
          button: e.button === 0 ? 'left' : e.button === 2 ? 'right' : 'middle',
        });
      }, true);

      // Capture mousemove (during drag)
      document.addEventListener('mousemove', (e) => {
        if (e.buttons > 0) {
          window.syncToOther({
            type: 'mousemove',
            x: e.clientX,
            y: e.clientY,
            buttons: e.buttons,
          });
        }
      }, true);

      // Capture mouseup (end of click or drag)
      document.addEventListener('mouseup', (e) => {
        window.syncToOther({
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
        window.syncToOther({
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
          window.syncToOther({
            type: 'scroll',
            scrollX: window.scrollX,
            scrollY: window.scrollY,
          });
        }, 50);
      }, true);

      // Capture input changes (fallback sync for paste, autocomplete, etc.)
      document.addEventListener('input', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
          window.syncToOther({
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
          window.syncToOther({
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
          window.syncToOther({ type: 'keydown', key: e.key });
          return;
        }

        // For text input, send keydown for special keys only
        if (focusedInput) {
          // Special keys that need keydown (arrows, backspace, delete, enter, tab, etc.)
          const specialKeys = ['Backspace', 'Delete', 'Enter', 'Tab', 'Escape',
            'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
            'Home', 'End', 'PageUp', 'PageDown'];
          if (specialKeys.includes(e.key) || e.ctrlKey || e.metaKey) {
            window.syncToOther({ type: 'keydown', key: e.key });
          }
          // Printable chars handled by keypress
        } else {
          // Outside text fields, send all keydowns
          window.syncToOther({ type: 'keydown', key: e.key });
        }
      }, true);

      // Capture keypress for printable characters in text fields
      document.addEventListener('keypress', (e) => {
        if (focusedInput && e.key.length === 1) {
          window.syncToOther({ type: 'keypress', char: e.key });
        }
      }, true);

      document.addEventListener('keyup', (e) => {
        // Send keyup for modifier keys
        if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
          window.syncToOther({ type: 'keyup', key: e.key });
        } else if (!focusedInput) {
          window.syncToOther({ type: 'keyup', key: e.key });
        }
      }, true);

      // Capture text selection changes in input fields
      document.addEventListener('select', (e) => {
        const el = e.target;
        if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
            typeof el.selectionStart === 'number') {
          window.syncToOther({
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
          window.syncToOther({ type: 'refresh' });
        }
        // Back: Alt+Left or Backspace (when not in input)
        if (e.altKey && e.key === 'ArrowLeft') {
          window.syncToOther({ type: 'goBack' });
        }
        // Forward: Alt+Right
        if (e.altKey && e.key === 'ArrowRight') {
          window.syncToOther({ type: 'goForward' });
        }
      }, true);

      // ============ VISUAL PIXEL DIFF ============
      // Compares screenshots pixel-by-pixel and overlays differences
      // Toggle with Cmd+Delete, enabled by default

      let diffModeEnabled = ${config.diffEnabled};
      let diffOverlay = null;
      let diffRunning = false;

      // Create or update the diff overlay
      function createDiffOverlay() {
        if (diffOverlay) return diffOverlay;

        diffOverlay = document.createElement('div');
        diffOverlay.id = 'dual-dom-diff-overlay';
        diffOverlay.style.cssText = \`
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 999999;
          mix-blend-mode: multiply;
        \`;
        document.body.appendChild(diffOverlay);
        return diffOverlay;
      }

      // Show diff result as overlay
      function showDiffOverlay(diffDataUrl, numDiffPixels, diffPercent) {
        const overlay = createDiffOverlay();

        if (numDiffPixels === 0) {
          overlay.innerHTML = \`
            <div style="position: fixed; bottom: 10px; left: 10px; background: #4CAF50; color: white;
                        padding: 12px 20px; border-radius: 8px; font-family: system-ui; font-size: 14px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.2); pointer-events: auto; cursor: pointer;
                        display: flex; align-items: center; gap: 10px;"
                 title="Click to dismiss">
              <span>✓ No visual differences detected</span>
              <span style="opacity: 0.7; font-size: 12px;">✕</span>
            </div>
          \`;
          // Add click handler to dismiss
          overlay.querySelector('div').onclick = () => clearDiffOverlay();
        } else {
          // Scale up the downscaled diff image to cover the viewport
          overlay.innerHTML = \`
            <img src="\${diffDataUrl}" style="width: 100%; height: 100%; opacity: 0.7; image-rendering: pixelated;">
            <div style="position: fixed; bottom: 10px; left: 10px; background: #f44336; color: white;
                        padding: 12px 20px; border-radius: 8px; font-family: system-ui; font-size: 14px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.2); pointer-events: auto; cursor: pointer;
                        display: flex; align-items: center; gap: 10px;"
                 title="Click to dismiss">
              <span>⚠ \${numDiffPixels.toLocaleString()} pixels differ (\${diffPercent}%)</span>
              <span style="opacity: 0.7; font-size: 12px;">✕</span>
            </div>
          \`;
          // Add click handler to dismiss
          overlay.querySelector('div:last-child').onclick = () => clearDiffOverlay();
        }

        console.log('[Dual DOM Driver] Diff overlay shown - ' +
          (numDiffPixels === 0 ? 'no differences' : numDiffPixels.toLocaleString() + ' pixels differ'));
      }

      // Clear the diff overlay
      function clearDiffOverlay() {
        if (diffOverlay) {
          diffOverlay.remove();
          diffOverlay = null;
        }
      }

      // Run visual diff comparison
      async function runDiff() {
        if (diffRunning) {
          console.log('[Dual DOM Driver] Diff already running, please wait...');
          return;
        }

        diffRunning = true;
        clearDiffOverlay();

        // Show loading indicator
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'dual-dom-diff-loading';
        loadingDiv.style.cssText = \`
          position: fixed; top: 10px; right: 10px; background: #2196F3; color: white;
          padding: 12px 20px; border-radius: 8px; font-family: system-ui; font-size: 14px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 999999;
        \`;
        loadingDiv.textContent = '⏳ Running visual diff...';
        document.body.appendChild(loadingDiv);

        try {
          console.log('[Dual DOM Driver] Running visual pixel diff...');
          const result = await window.runVisualDiff();

          loadingDiv.remove();

          if (result.error) {
            console.error('[Dual DOM Driver] Diff error:', result.error);
            return;
          }

          showDiffOverlay(result.diffDataUrl, result.numDiffPixels, result.diffPercent);
        } catch (err) {
          console.error('[Dual DOM Driver] Diff error:', err);
          loadingDiv.remove();
        } finally {
          diffRunning = false;
        }
      }

      // Toggle diff mode with D key (when not in input field)
      // D = run diff, Shift+D = clear diff overlay
      document.addEventListener('keydown', (e) => {
        // Only trigger on 'd' or 'D' key, not in input fields
        if ((e.key === 'd' || e.key === 'D') && !focusedInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();

          if (e.shiftKey) {
            // Shift+D: clear diff overlay
            diffModeEnabled = false;
            clearDiffOverlay();
            console.log('[Dual DOM Driver] Visual diff cleared');
          } else {
            // D: run diff
            diffModeEnabled = true;
            runDiff();
          }
        }
      }, true);

      console.log('[Dual DOM Driver] Event capture active - click, drag, wheel, text input, navigation supported');
      console.log('[Dual DOM Driver] Press D to run visual diff, Shift+D to clear');
    })();
  `;

  // Inject script into both pages
  await Promise.all([
    rightPage.evaluate(injectScript),
    leftPage.evaluate(injectScript),
  ]);

  // Track navigation to sync back/forward/refresh
  let isNavigating = false;
  let linkClickTime = { left: 0, right: 0 };
  const LINK_NAV_WINDOW = 3000;
  const rightOrigin = new URL(config.rightUrl).origin;
  const leftOrigin = new URL(config.leftUrl).origin;

  // Expose function to signal that a link was clicked (navigation expected)
  await rightPage.exposeFunction('expectLinkNavigation', () => {
    linkClickTime.right = Date.now();
  });
  await leftPage.exposeFunction('expectLinkNavigation', () => {
    linkClickTime.left = Date.now();
  });

  // Sync navigation when right page navigates
  rightPage.on('framenavigated', async (frame) => {
    if (frame !== rightPage.mainFrame()) return;
    if (isNavigating) return;

    const timeSinceClick = Date.now() - linkClickTime.right;
    if (timeSinceClick > LINK_NAV_WINDOW) return;

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

  // Sync navigation when left page navigates
  leftPage.on('framenavigated', async (frame) => {
    if (frame !== leftPage.mainFrame()) return;
    if (isNavigating) return;

    const timeSinceClick = Date.now() - linkClickTime.left;
    if (timeSinceClick > LINK_NAV_WINDOW) return;

    try {
      isNavigating = true;
      const leftUrl = frame.url();
      const rightUrl = leftUrl.replace(leftOrigin, rightOrigin);

      if (rightPage.url() !== rightUrl) {
        console.log(`[sync] Navigating right to: ${rightUrl}`);
        await rightPage.goto(rightUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    } catch (err) {
      // Page might be navigating
    } finally {
      isNavigating = false;
    }
  });

  // Re-inject script on navigation for both pages
  rightPage.on('domcontentloaded', async () => {
    try {
      await rightPage.evaluate(injectScript);
    } catch (err) {
      // Page might be navigating
    }
  });

  leftPage.on('domcontentloaded', async () => {
    try {
      await leftPage.evaluate(injectScript);
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
