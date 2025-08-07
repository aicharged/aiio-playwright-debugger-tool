// /docker/frontend/dev-aiio-platform-oleg/docker/tools/playwright-debugger/host-debug-editor.mjs
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';

// --- Configuration ---
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'frontend', 'test-results');
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const AUTH_EMAIL = 'your-login';
const AUTH_PASSWORD = 'your-password';

// --- Helper Functions ---
function parseArgs() {
  const args = process.argv.slice(2);
  const urlArg = args.find(arg => !arg.startsWith('--'));
  const authFlag = args.includes('--auth');
  const wssFlag = args.includes('--wss');
  const actionsArg = args.find(arg => arg.startsWith('--run-actions-from='));
  const actionsFile = actionsArg ? actionsArg.split('=')[1] : null;

  if (!urlArg) {
    console.error('❌ Error: Please provide a URL.');
    console.log('Usage: node host-debug-editor.mjs <URL> [--auth] [--wss] [--run-actions-from=<file>]');
    process.exit(1);
  }

  try {
    return {
      targetUrl: new URL(urlArg),
      useAuth: authFlag,
      logWss: wssFlag,
      actionsFile: actionsFile,
    };
  } catch (error) {
    console.error(`❌ Error: Invalid URL provided: "${urlArg}"`);
    process.exit(1);
  }
}

function createScreenshotDirectory() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

function generateScreenshotPath(url) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${url.hostname.replace(/[^a-z0-9]/gi, '_')}-${timestamp}.png`;
  return path.join(SCREENSHOT_DIR, filename);
}

async function logMinifiedDOM(page) {
  try {
    const domStructure = await page.evaluate(() => {
      function extractElement(element, depth = 0, maxDepth = 5) {
        if (depth > maxDepth) return '[...deep]';
        
        const tag = element.tagName?.toLowerCase() || 'text';
        const classes = element.className ? `.${element.className.split(' ').filter(c => c).slice(0, 2).join('.')}` : '';
        const id = element.id ? `#${element.id}` : '';
        
        let text = '';
        if (element.nodeType === Node.TEXT_NODE) {
          text = element.textContent?.trim().substring(0, 16) || '';
          return text ? `"${text}${text.length > 16 ? '...' : ''}"` : '';
        }
        
        // Get direct text content (not from children) and also inner text for buttons/inputs/labels
        let directText = Array.from(element.childNodes)
          .filter(node => node.nodeType === Node.TEXT_NODE)
          .map(node => node.textContent?.trim())
          .filter(text => text && text.length > 0)
          .join(' ');
        
        // For interactive elements, also try to get their text content or value
        if (!directText && ['button', 'input', 'a', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span'].includes(tag)) {
          if (element.value) {
            directText = element.value;
          } else if (element.placeholder) {
            directText = `[${element.placeholder}]`;
          } else if (element.innerText) {
            directText = element.innerText.trim();
          } else if (element.textContent) {
            directText = element.textContent.trim();
          }
        }
        
        // Limit text length
        directText = directText.substring(0, 20);
        const textPart = directText ? ` "${directText}${directText.length > 20 ? '...' : ''}"` : '';
        
        const children = Array.from(element.children)
          .map(child => extractElement(child, depth + 1, maxDepth))
          .filter(child => child && child !== '')
          .slice(0, 10); // Limit children to prevent huge output
        
        const childrenPart = children.length > 0 ? ` [${children.join(', ')}]` : '';
        const indent = '  '.repeat(depth);
        
        return `${indent}${tag}${id}${classes}${textPart}${childrenPart}`;
      }
      
      const body = document.body;
      if (!body) return 'No body element found';
      
      return extractElement(body);
    });
    
    console.log('🌳 DOM Structure (minified):');
    console.log('═'.repeat(80));
    console.log(domStructure);
    console.log('═'.repeat(80));
    
  } catch (error) {
    console.error(`❌ Error extracting DOM structure: ${error.message}`);
  }
}

async function takeAnnotatedScreenshot(page, url) {
  console.log('🎨 Generating improved, DevTools-style annotated screenshot...');
  const annotatedScreenshotPath = generateScreenshotPath(url).replace('.png', '.annotated.png');

  try {
    // Inject JS to create and position the overlays. This is a complex operation done in the browser context.
    await page.evaluate(() => {
      // Function to generate a more concise CSS selector
      const getCssSelector = (el) => {
        if (!(el instanceof Element)) return;
        let path = [];
        while (el.nodeType === Node.ELEMENT_NODE) {
          let selector = el.nodeName.toLowerCase();
          if (el.id) {
            selector += `#${el.id}`;
            path.unshift(selector);
            break; // ID is unique, no need to go further
          } else {
            let sib = el, nth = 1;
            while (sib = sib.previousElementSibling) {
              if (sib.nodeName.toLowerCase() == selector) nth++;
            }
            if (el.parentElement && el.parentElement.querySelectorAll(selector).length > 1) {
              selector += `:nth-of-type(${nth})`;
            }
          }
          path.unshift(selector);
          el = el.parentNode;
        }
        // Truncate very long selectors
        let joinedPath = path.join(' > ');
        if (joinedPath.length > 100) {
            joinedPath = '...' + joinedPath.substring(joinedPath.length - 97);
        }
        return joinedPath;
      };

      // Create a single container for all our overlays
      const container = document.createElement('div');
      container.id = 'ai-debugger-overlay-container';
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
      container.style.zIndex = '999999';
      container.style.pointerEvents = 'none';
      document.body.appendChild(container);

      // Select all elements, but filter out tiny or invisible ones
      document.querySelectorAll('body *:not(script):not(style):not(path):not(svg *):not(#ai-debugger-overlay-container):not(#ai-debugger-overlay-container *)').forEach(el => {
        const rect = el.getBoundingClientRect();
        // Only annotate elements that are reasonably sized and visible
        if (rect.width > 15 && rect.height > 15 && rect.top >= 0 && rect.left >= 0) {
          const selector = getCssSelector(el);

          // Create the blue highlight box - much more transparent now
          const highlightBox = document.createElement('div');
          highlightBox.style.position = 'absolute';
          highlightBox.style.top = `${window.scrollY + rect.top}px`;
          highlightBox.style.left = `${window.scrollX + rect.left}px`;
          highlightBox.style.width = `${rect.width}px`;
          highlightBox.style.height = `${rect.height}px`;
          highlightBox.style.backgroundColor = 'rgba(66, 133, 244, 0.1)'; // Lighter, more transparent Google Blue
          highlightBox.style.border = '1px solid rgba(66, 133, 244, 0.5)'; // Softer border
          highlightBox.style.boxSizing = 'border-box';
          container.appendChild(highlightBox);

          // Create the tooltip with the selector path - now more subtle
          const tooltip = document.createElement('div');
          tooltip.textContent = selector;
          tooltip.style.position = 'absolute';
          tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.8)'; // Slightly transparent black
          tooltip.style.color = 'white';
          tooltip.style.fontFamily = 'monospace';
          tooltip.style.fontSize = '9px'; // smaller
          tooltip.style.padding = '2px 4px';
          tooltip.style.borderRadius = '3px';
          tooltip.style.maxWidth = '250px';
          tooltip.style.overflow = 'hidden';
          tooltip.style.textOverflow = 'ellipsis';
          tooltip.style.whiteSpace = 'nowrap';
          
          // Position tooltip just outside the bottom-left corner
          let tooltipTop = window.scrollY + rect.bottom + 2;
          let tooltipLeft = window.scrollX + rect.left;

          // Keep it on screen
          if (tooltipLeft < 5) tooltipLeft = 5;
          if (tooltipLeft + 250 > window.innerWidth) { // Keep it from overflowing right
              tooltipLeft = window.innerWidth - 255;
          }
          if (tooltipTop + 20 > window.innerHeight + window.scrollY) { // Keep it from overflowing bottom
              tooltipTop = window.scrollY + rect.top - 18; // move it above if it overflows bottom
          }

          tooltip.style.top = `${tooltipTop}px`;
          tooltip.style.left = `${tooltipLeft}px`;
          
          container.appendChild(tooltip);
        }
      });
    });

    // Take the screenshot
    await page.screenshot({ path: annotatedScreenshotPath, fullPage: true });
    console.log(`✅ Annotated screenshot (DevTools style) saved to: ${annotatedScreenshotPath}`);

    // Clean up the injected elements
    await page.evaluate(() => {
      const container = document.getElementById('ai-debugger-overlay-container');
      if (container) container.remove();
    });

    return annotatedScreenshotPath;
  } catch (error) {
    console.error(`❌ Error generating annotated screenshot: ${error.message}`);
    return null;
  }
}


// --- Main Execution ---
(async () => {
  const { targetUrl, useAuth, logWss, actionsFile } = parseArgs();
  createScreenshotDirectory();

  const wsLog = [];
  let subscribedChannel = null; // To store the subscribed channel name
  const boundEvents = new Set();  // To store all bound event names

  console.log(`🚀 Launching browser to test: ${targetUrl.href}`);
  if (useAuth) console.log('🔒 Auth mode enabled.');
  if (logWss) console.log('🔌 WebSocket logging enabled.');
  if (actionsFile) console.log(`🤖 AI actions will be run from: ${actionsFile}`);


  const browser = await chromium.launch({ headless: true });
  let context = await browser.newContext();
  let page = await context.newPage();

  // --- Event Listeners for Debugging ---
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[vite]')) return; // Filter out Vite noise
    console.log(`[CONSOLE] ${msg.type().toUpperCase()}: ${text}`);

    // --- Capture WebSocket Subscription Info ---
    if (text.includes('Subscribing to private channel:')) {
      const match = text.match(/Subscribing to private channel: (.*)/);
      if (match && match[1]) {
        subscribedChannel = match[1].trim();
      }
    }
    if (text.includes('Binding to event:')) {
      const match = text.match(/Binding to event: (.*)/);
      if (match && match[1]) {
        boundEvents.add(match[1].trim());
      }
    }
    // --- End Capture ---
  });
  page.on('pageerror', error => console.log(`[PAGE ERROR] ${error.message}`));
  page.on('request', request => console.log(`[NETWORK] >> ${request.method()} ${request.url()}`));
  page.on('response', response => {
    if (!response.ok() || response.url().includes('login')) {
       console.log(`[NETWORK] << ${response.status()} ${response.url()}`);
    }
  });
   page.on('framenavigated', frame => {
        console.log(`[NAV] Navigated to: ${frame.url()}`);
    });

  if (logWss) {
    page.on('websocket', ws => {
      const url = ws.url(); // Capture URL at creation

      const logFrame = (direction, payloadBuffer) => {
        const timestamp = new Date().toISOString();
        const payloadString = payloadBuffer.toString();
        let event = 'data';
        let channel = '-';
        let data = payloadString;

        try {
          const parsed = JSON.parse(payloadString);
          event = parsed.event || 'data';
          
          // For subscribe events, channel is in data object
          if (parsed.event === 'pusher:subscribe' && parsed.data && parsed.data.channel) {
            channel = parsed.data.channel;
          } else if (parsed.channel) {
            channel = parsed.channel;
          }

          // Don't repeat event/channel info in payload
          if (parsed.data) {
             data = typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data);
          } else {
             // If no data key, show the whole thing minus the event
             const { event, ...rest } = parsed;
             data = JSON.stringify(rest);
          }
          
        } catch (e) {
          // Not JSON, treat as raw. Could be a simple ping/pong from a non-Pusher service.
          event = 'raw';
        }

        wsLog.push({ timestamp, url, direction, event, channel, payload: data });
        console.log(`[WSS] ${direction} | Event: ${event} | Channel: ${channel}`);
      };
      
      const logConnection = (type, details) => {
        const timestamp = new Date().toISOString();
        wsLog.push({ timestamp, url, direction: type, event: type, channel: '-', payload: details });
        console.log(`[WSS] ${type} | ${details} on ${url}`);
      };

      logConnection('OPEN', 'WebSocket Connected');
      ws.on('framesent', event => logFrame('SENT', event.payload));
      ws.on('framereceived', event => logFrame('RECV', event.payload));
      ws.on('close', () => logConnection('CLOSE', 'WebSocket Closed'));
    });
  }

  try {
    console.log(`Navigating to ${targetUrl.href}...`);
    await page.goto(targetUrl.href, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT });
    console.log('✅ Initial navigation successful.');

    if (useAuth) {
      console.log('🕵️  Checking for login form...');
      const loginFormVisible = await page.locator('input#email').isVisible();

      if (loginFormVisible) {
        console.log('✅ Login form found on the initial page. Proceeding with login...');
        await page.fill('input#email', AUTH_EMAIL);
        await page.fill('input#password', AUTH_PASSWORD);
        const responsePromise = page.waitForResponse(
          response => response.url().includes('/api/v1/auth/login') && ['POST', 'OPTIONS'].includes(response.request().method())
        );

        await page.click('button[type="submit"]');
        console.log('➡️ Login form submitted. Waiting for API response...');

        const response = await responsePromise;
        const responseBody = await response.json().catch(() => ({}));
        console.log(`✅ API Response Received:
          - Status: ${response.status()} ${response.statusText()}
          - Body: ${JSON.stringify(responseBody, null, 2)}
        `);

        if (response.ok()) {
            console.log('👍 API response is OK. Waiting for login button to disappear...');
            await page.locator('header button:has-text("Přihlásit se")').waitFor({ state: 'hidden', timeout: 15000 });
            console.log('✅ Login button disappeared, assuming login was successful.');

            // Verify persistence only if the flag is provided
            if (process.argv.includes('--verify-persistence')) {
              console.log('🔄 Performing hard refresh to verify session persistence...');
              
              // 1. Save storage state
              const storageState = await context.storageState();
              console.log('💾 Storage state saved.');

              // 2. Close the current context
              await context.close();
              console.log('🎭 Browser context closed.');

              // 3. Create a new context with the saved state
              context = await browser.newContext({ storageState });
              page = await context.newPage(); // Re-assign page to the new context
              console.log('✨ New browser context created with saved state.');

              // 4. Re-attach loggers to the new page object
                page.on('console', msg => {
                    const text = msg.text();
                    if (text.includes('[vite]')) return;
                    console.log(`[CONSOLE] ${msg.type().toUpperCase()}: ${text}`);
                });
                page.on('pageerror', error => console.log(`[PAGE ERROR] ${error.message}`));
                page.on('request', request => console.log(`[NETWORK] >> ${request.method()} ${request.url()}`));
                page.on('response', response => {
                    if (!response.ok() || response.url().includes('login')) {
                       console.log(`[NETWORK] << ${response.status()} ${response.url()}`);
                    }
                });
                page.on('framenavigated', frame => {
                    console.log(`[NAV] Navigated to: ${frame.url()}`);
                });

              // 5. Go to the SAME URL again
              console.log(`Navigating to ${page.url()} again...`);
              await page.goto(page.url(), { waitUntil: 'networkidle' });
              console.log('✅ Page reloaded in new context.');

              console.log('👍 Checking for avatar again after hard refresh...');
              const avatarSelector = 'header button img.rounded-full';
              await page.locator(avatarSelector).first().waitFor({ state: 'visible', timeout: 10000 });
              console.log('✅ Avatar is still present after hard refresh! Session persisted correctly.');
            }
        } else {
            console.error('❌ API response indicates a login failure.');
        }

        console.log(`Final URL after login attempt: ${page.url()}`);

      } else {
        console.log('🟡 Login form not found. Looking for login button in header...');
        const loginButton = page.locator('header a[href="/login"], header button:has-text("Přihlásit se")').first();
        if (await loginButton.isVisible()) {
            const originalUrlBeforeLogin = page.url(); // Uložíme si původní URL
            await loginButton.click();
            console.log('➡️ Clicked login button. Waiting for login page...');
            await page.waitForURL('**/login', { timeout: DEFAULT_TIMEOUT });
          
            console.log('✅ Reached login page. Filling form...');
            await page.fill('input#email', AUTH_EMAIL);
            await page.fill('input#password', AUTH_PASSWORD);

            const responsePromise = page.waitForResponse(
              response => response.url().includes('/api/v1/auth/login') && ['POST', 'OPTIONS'].includes(response.request().method())
            );

            await page.click('button[type="submit"]');
            console.log('➡️ Login submitted. Waiting for API response...');

            const response = await responsePromise;
            if (response.ok()){
                console.log('✅ Login API call successful. Waiting for redirect from login page...');
                await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: DEFAULT_TIMEOUT });
                console.log(`✅ Redirected to: ${page.url()}`);

                if (process.argv.includes('--verify-persistence')) {
                    console.log(`↩️ Navigating back to original URL for persistence check: ${originalUrlBeforeLogin}`);
                    await page.goto(originalUrlBeforeLogin, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT });
                    console.log('✅ Back on the original page.');

                    console.log('🔄 Performing hard refresh to verify session persistence...');
                    const storageState = await context.storageState();
                    await context.close();
                    context = await browser.newContext({ storageState });
                    page = await context.newPage();
                     page.on('console', msg => {
                        const text = msg.text();
                        if (text.includes('[vite]')) return;
                        console.log(`[CONSOLE] ${msg.type().toUpperCase()}: ${text}`);
                    });
                    page.on('pageerror', error => console.log(`[PAGE ERROR] ${error.message}`));
                    page.on('request', request => console.log(`[NETWORK] >> ${request.method()} ${request.url()}`));
                    page.on('response', response => {
                        if (!response.ok() || response.url().includes('login')) {
                           console.log(`[NETWORK] << ${response.status()} ${response.url()}`);
                        }
                    });
                    page.on('framenavigated', frame => {
                        console.log(`[NAV] Navigated to: ${frame.url()}`);
                    });
                    
                    await page.goto(originalUrlBeforeLogin, { waitUntil: 'networkidle' });
                    console.log('✅ Page reloaded in new context.');

                    console.log('👍 Checking for avatar again after hard refresh...');
                    const avatarSelector = 'header button img.rounded-full';
                    await page.locator(avatarSelector).first().waitFor({ state: 'visible', timeout: 10000 });
                    console.log('✅ Avatar is still present after hard refresh! Session persisted correctly.');
                }

            } else {
                 console.error('❌ Login API call failed.');
            }

        } else {
           console.warn('⚠️ Could not find a login button on the page. Taking screenshot of current state.');
        }
      }
    }
    
    // --- Execute AI-generated actions if provided ---
    if (actionsFile) {
      console.log(`🤖 Executing AI-generated actions from ${actionsFile}...`);
      try {
        const actionsModule = await import(path.resolve(actionsFile));
        if (typeof actionsModule.default === 'function') {
          await actionsModule.default(page);
          console.log('✅ AI-generated actions completed successfully.');
        } else {
          console.error('❌ Error: The actions file must export a default async function.');
        }
      } catch (error) {
        console.error(`❌ Error executing AI actions from ${actionsFile}: ${error.message}`);
        // Continue execution, but this is a critical error to note
      }
    }


    // Log minified DOM structure
    console.log('🌳 Extracting DOM structure...');
    await logMinifiedDOM(page);

    // Wait for a few seconds to ensure all dynamic content has loaded
    console.log('⏳ Waiting for 5 seconds before taking screenshot...');
    await page.waitForTimeout(5000);

    // Take the annotated screenshot for AI analysis
    await takeAnnotatedScreenshot(page, targetUrl);

    console.log('📸 Taking final screenshot...');
    const screenshotPath = generateScreenshotPath(targetUrl);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`✅ Screenshot saved to: ${screenshotPath}`);

  } catch (error) {
    console.error(`❌ An error occurred: ${error.message}`);
    
    // Try to log DOM even in error case
    console.log('🌳 Extracting DOM structure after error...');
    await logMinifiedDOM(page);
    
    const errorScreenshotPath = path.join(SCREENSHOT_DIR, `ERROR-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    await page.screenshot({ path: errorScreenshotPath, fullPage: true });
    console.log(`📸 Error screenshot saved to: ${errorScreenshotPath}`);
  } finally {
    if (logWss && wsLog.length > 0) {
      console.log('\n\n--- 🔌 WebSocket Communication Report ---');
      console.log('URL:', wsLog[0]?.url || 'N/A');
      console.log('═'.repeat(120));
      console.log(
        'Timestamp'.padEnd(30),
        'Dir'.padEnd(6),
        'Event'.padEnd(30),
        'Channel'.padEnd(30),
        'Payload'
      );
      console.log('─'.repeat(120));

      wsLog.forEach(entry => {
        const direction = entry.direction.padEnd(5);
        let arrow = '';
        if (direction.trim() === 'SENT') arrow = '⬆️';
        if (direction.trim() === 'RECV') arrow = '⬇️';
        if (direction.trim() === 'OPEN') arrow = '✅';
        if (direction.trim() === 'CLOSE') arrow = '❌';

        const payloadPreview = (entry.payload || '').substring(0, 100);

        console.log(
          `${entry.timestamp}`.padEnd(30),
          `${arrow} ${direction}`.padEnd(6),
          `${entry.event}`.padEnd(30),
          `${entry.channel}`.padEnd(30),
          `${payloadPreview}${payloadPreview.length === 100 ? '...' : ''}`
        );
      });
      console.log('═'.repeat(120));
    }
    
    // --- Print WebSocket Subscription Report ---
    if (subscribedChannel || boundEvents.size > 0) {
        console.log('\n\n--- 📡 WebSocket Subscription Report ---');
        console.log(`[CHANNEL]: ${subscribedChannel || 'N/A'}`);
        Array.from(boundEvents).forEach(event => {
            console.log(`[EVENT]: ${event}`);
        });
        console.log('--- END WebSocket Subscription Report ---');
    }

    await browser.close();
    console.log('Browser closed.');
  }
})();