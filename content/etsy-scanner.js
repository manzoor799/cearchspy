/**
 * E Keyword Spy — Content Script for Etsy.com
 *
 * Runs directly inside the Etsy tab:
 * 1. Live Typing Movement: Physically types queries into Etsy's search bar
 *    (e.g., "resume a", "resume b", ...), triggering genuine DOM events so
 *    the user sees the live search bar movement on the Etsy page!
 * 2. Real-Time Autocomplete Extraction: Pulls live suggestions directly from
 *    Etsy's active session and autocomplete dropdown.
 * 3. Modern SaaS HUD Overlay: Displays a non-intrusive live progress HUD on Etsy.
 */

(() => {
  const SCRIPT_VERSION = '1.3.0';

  // If already running this exact version, avoid duplicate setup
  if (window.__ekeywordspy_version === SCRIPT_VERSION && window.__ekeywordspy_listening) {
    return;
  }
  window.__ekeywordspy_version = SCRIPT_VERSION;
  window.__ekeywordspy_listening = true;

  // Detach previous listener if dynamically re-injected
  if (window.__ekeywordspy_message_listener) {
    try {
      chrome.runtime.onMessage.removeListener(window.__ekeywordspy_message_listener);
    } catch {}
  }

  let activeIndicator = null;
  let activeSearchInput = null;

  /**
   * Finds Etsy's main search input element on the page.
   * Supports all variations across desktop, tablet, and responsive headers,
   * as well as regional Etsy sites (e.g., Etsy Pakistan, UK, etc.).
   * @returns {HTMLInputElement|null}
   */
  function findSearchInput() {
    return document.querySelector(
      '#global-enhancements-search-query, input[name="search_query"], input[data-id="search-query"], input[placeholder*="Search" i], input[type="search"], input[aria-label*="Search" i], input[role="searchbox"], input[role="combobox"], form[action*="/search"] input, header input, nav input, input[name="q"], #search-query'
    );
  }

  /**
   * Visually types the query into Etsy's search input with live focus and input events.
   * Uses native prototype value setter so React / Preact internal fiber detects the input change.
   * @param {string} query
   */
  function typeIntoEtsySearchBar(query) {
    const input = findSearchInput();
    if (!input) return null;

    activeSearchInput = input;

    // Highlight Etsy's search bar with an active E Keyword Spy border (#4032C9)
    if (!input.dataset.ekeywordspyActive) {
      input.dataset.ekeywordspyActive = 'true';
      input.dataset.origBorder = input.style.border || '';
      input.dataset.origBoxShadow = input.style.boxShadow || '';
      input.dataset.origTransition = input.style.transition || '';
    }

    input.style.border = '1.5px solid #4032C9';
    input.style.boxShadow = '0 0 0 3px rgba(64, 50, 201, 0.16)';
    input.style.transition = 'all 0.18s ease';

    // Set text value via native prototype descriptor to notify React / Preact
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(input, query);
      } else {
        input.value = query;
      }
    } catch {
      input.value = query;
    }

    // Dispatch DOM & Synthetic events so Etsy's internal autocomplete listeners fire
    try {
      input.focus();
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const lastChar = query.slice(-1);
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: lastChar }));
      input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: lastChar }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: lastChar }));
    } catch {}

    return input;
  }

  /**
   * Restores Etsy's search bar to its original state when done.
   */
  function resetEtsySearchBar() {
    if (activeSearchInput && activeSearchInput.dataset.ekeywordspyActive) {
      activeSearchInput.style.border = activeSearchInput.dataset.origBorder || '';
      activeSearchInput.style.boxShadow = activeSearchInput.dataset.origBoxShadow || '';
      activeSearchInput.style.transition = activeSearchInput.dataset.origTransition || '';
      delete activeSearchInput.dataset.ekeywordspyActive;
    }
    activeSearchInput = null;
  }

  /**
   * Shows a floating live status dock on the Etsy page during scanning.
   * Styled according to the White-Light design system.
   * @param {string} text
   */
  function showStatusIndicator(text) {
    if (!activeIndicator) {
      activeIndicator = document.createElement('div');
      activeIndicator.id = 'ekeywordspy-page-indicator';
      activeIndicator.setAttribute('data-ekeywordspy-ignore', 'true');
      Object.assign(activeIndicator.style, {
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: '9999999',
        backgroundColor: '#FFFFFF',
        color: '#0F172A',
        padding: '6px 14px 6px 8px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: '600',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        WebkitFontSmoothing: 'antialiased',
        boxShadow: '-2px 4px 12px rgba(15, 23, 42, 0.1)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        pointerEvents: 'none',
        transition: 'all 0.18s ease',
        border: '1px solid #CBD5E1',
      });
      document.body.appendChild(activeIndicator);
    }
    activeIndicator.innerHTML = `
      <span style="background:#4032C9;color:#FFFFFF;font-weight:700;border-radius:4px;padding:2px 7px;font-size:11px;line-height:14px;letter-spacing:0.02em;">LIVE SCAN</span>
      <span style="color:#0F172A;font-weight:600;font-size:12px;">${text}</span>
    `;
  }

  function hideStatusIndicator() {
    if (activeIndicator) {
      activeIndicator.remove();
      activeIndicator = null;
    }
    resetEtsySearchBar();
  }

  /**
   * Fetches suggestions using Etsy's same-origin session credentials.
   * Queries multiple internal endpoints to ensure 100% compatibility across AI browsers & Chrome.
   * @param {string} query
   * @returns {Promise<string[]>}
   */
  async function fetchSameOriginSuggest(query) {
    const endpoints = [
      `/search/suggest?q=${encodeURIComponent(query)}&lang=en-US`,
      `/suggestions_ajax.php?search_query=${encodeURIComponent(query)}`,
    ];

    for (const url of endpoints) {
      try {
        const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(3500)
          : undefined;

        const res = await fetch(url, {
          headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
          credentials: 'same-origin',
          signal,
        });
        if (!res.ok) continue;
        const data = await res.json();

        if (Array.isArray(data)) {
          if (typeof data[0] === 'string') return data;
          return data.map(item => item?.query || item?.text || '').filter(Boolean);
        }
        if (data && typeof data === 'object') {
          const list = data.results || data.suggestions || data.queries || [];
          if (Array.isArray(list) && list.length > 0) {
            return list.map(item => (typeof item === 'string' ? item : item?.query || item?.text || '')).filter(Boolean);
          }
        }
      } catch {}
    }
    return [];
  }

  /**
   * Scrapes suggestions from Etsy's live search dropdown DOM if open.
   * Supports [data-ui="autocomplete-results"], ul[role="listbox"], etc.
   * @returns {string[]}
   */
  function scrapeDropdownDOM() {
    const suggestions = [];
    const container = document.querySelector(
      '#global-enhancements-search-suggestions, [data-search-suggestions], [data-ui="autocomplete-results"], div[role="listbox"], ul[role="listbox"], .search-suggestions-list'
    );
    if (!container) return suggestions;

    const items = container.querySelectorAll('li, div[role="option"], [data-suggestion], [data-query]');
    for (const item of items) {
      // Skip trending items with thumbnails (under "Top searches this week")
      if (item.querySelector('img')) continue;

      const dataQuery = item.getAttribute('data-query') || item.getAttribute('data-suggestion');
      const text = dataQuery || item.textContent || '';
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean && !clean.toLowerCase().includes('find shop names')) {
        suggestions.push(clean);
      }
    }

    return suggestions;
  }

  /**
   * Detects whether Etsy or DataDome has displayed a genuine, blocking CAPTCHA / slider challenge.
   * Guarantees 0% false positives when browsing Etsy normally.
   * NEVER flags as a challenge when URL contains dd_referrer= or when Etsy's header/nav exists.
   * Returns true ONLY if an interactive challenge slider is physically visible on the screen.
   * @returns {boolean}
   */
  function isVerificationChallengePresent() {
    try {
      // 1. PRIMARY HEALTH CHECK: If Etsy's genuine search bar is present in DOM,
      // the page is functional and healthy! NEVER flag as captcha.
      const searchInput = findSearchInput();
      if (searchInput) {
        return false;
      }

      // 2. If Etsy's main header, nav, or content container exists, the page is 100% HEALTHY!
      if (document.querySelector('header, nav, #gnav-header, .wt-header, [data-wt-header], footer, #content, [role="main"], [data-header]')) {
        return false;
      }

      const title = (document.title || '').toLowerCase();
      // 3. If title includes "Etsy", it's the genuine Etsy site, not a standalone captcha page
      if (title.includes('etsy')) {
        // Only consider it a challenge if a physical slider iframe or element is visible right now
        const challengeIframe = document.querySelector('iframe[src*="captcha-delivery.com"]');
        if (challengeIframe) {
          const rect = challengeIframe.getBoundingClientRect();
          if (rect.width > 250 && rect.height > 180 && rect.top >= 0 && rect.top < window.innerHeight) {
            return true;
          }
        }
        const sliderBox = document.querySelector('.datadome-slider, #dd-captcha');
        if (sliderBox) {
          const rect = sliderBox.getBoundingClientRect();
          if (rect.width > 120 && rect.height > 35 && rect.top >= 0 && rect.top < window.innerHeight) {
            return true;
          }
        }
        return false;
      }

      const url = window.location.href || '';

      // 4. Standalone challenge page on captcha delivery domain
      if (url.includes('captcha-delivery.com/captcha/') || url.includes('/challenge.html')) {
        return true;
      }

      // 5. Standalone challenge title without Etsy brand
      if (
        title.includes('robot or human') ||
        title.includes('are you a human') ||
        (title.includes('security check') && !title.includes('etsy'))
      ) {
        return true;
      }

      // 6. Genuine, VISIBLE blocking DataDome challenge iframe
      const challengeIframe = document.querySelector('iframe[src*="captcha-delivery.com"]');
      if (challengeIframe) {
        const rect = challengeIframe.getBoundingClientRect();
        if (rect.width > 250 && rect.height > 180 && rect.top >= 0 && rect.top < window.innerHeight) {
          return true;
        }
      }

      // 7. Explicit DataDome slider element that is physically rendered and visible
      const sliderBox = document.querySelector('.datadome-slider, #dd-captcha');
      if (sliderBox) {
        const rect = sliderBox.getBoundingClientRect();
        if (rect.width > 120 && rect.height > 35 && rect.top >= 0 && rect.top < window.innerHeight) {
          return true;
        }
      }
    } catch {
      // Fallback
    }
    return false;
  }

  /**
   * Displays an amber alert HUD on Etsy when a verification challenge is detected.
   */
  function showCaptchaPausedIndicator() {
    if (!activeIndicator) {
      activeIndicator = document.createElement('div');
      activeIndicator.id = 'ekeywordspy-page-indicator';
      document.body.appendChild(activeIndicator);
    }
    Object.assign(activeIndicator.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '9999999',
      backgroundColor: '#FFFFFF',
      color: '#0F172A',
      padding: '8px 16px 8px 10px',
      borderRadius: '9999px',
      fontSize: '12px',
      fontWeight: '600',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      boxShadow: '0 8px 24px rgba(217, 119, 6, 0.25)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      border: '1.5px solid #F59E0B',
      pointerEvents: 'none',
      transition: 'all 0.18s ease',
    });
    activeIndicator.innerHTML = `
      <span style="background:#D97706;color:#FFFFFF;font-weight:700;border-radius:4px;padding:2px 7px;font-size:11px;line-height:14px;letter-spacing:0.02em;">VERIFICATION REQUIRED</span>
      <span style="color:#92400E;font-weight:600;font-size:12px;">Slide the slider on this page to continue</span>
    `;
  }

  // Runtime Message Listener with dynamic re-bind support
  const messageListener = (message, sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === 'ETSY_PING') {
      const challenged = isVerificationChallengePresent();
      sendResponse({
        success: true,
        url: window.location.href,
        challenged,
        hasSearchInput: Boolean(findSearchInput()),
        version: SCRIPT_VERSION,
      });
      return false;
    }

    if (message.type === 'CHECK_VERIFICATION_RESOLVED') {
      const challenged = isVerificationChallengePresent();
      const hasSearchInput = Boolean(findSearchInput());
      const isResolved = !challenged || hasSearchInput;
      if (isResolved) {
        hideStatusIndicator();
      }
      sendResponse({
        resolved: isResolved,
        captchaDetected: challenged && !hasSearchInput,
        hasSearchInput,
        url: window.location.href,
        version: SCRIPT_VERSION,
      });
      return false;
    }

    if (message.type === 'ETSY_SCAN_PROBE') {
      // Check if challenge screen is currently active
      if (isVerificationChallengePresent()) {
        showCaptchaPausedIndicator();
        sendResponse({
          success: false,
          captchaDetected: true,
          url: window.location.href,
          message: 'Etsy verification slider challenge detected on page',
        });
        return false;
      }

      (async () => {
        try {
          const query = message.query;
          const seedIndex = message.seedIndex || 1;
          const totalSeeds = message.totalSeeds || 1;
          const isRootProbe = Boolean(message.isRootProbe);
          const branchIndex = message.branchIndex || seedIndex;
          const totalBranches = message.totalBranches || totalSeeds;

          // 1. Physically type into Etsy's search bar with live movement
          typeIntoEtsySearchBar(query);

          // 2. Update HUD overlay based on scan phase
          if (isRootProbe) {
            showStatusIndicator(`Auto-Suggest Harvest: "${query}"`);
            // Allow Etsy's live autocomplete dropdown to fully appear
            await new Promise(r => setTimeout(r, message.pacingDelayMs || 1500));
          } else {
            const branchText = totalBranches > 1 ? ` (Branch ${branchIndex}/${totalBranches})` : '';
            showStatusIndicator(`E Keyword Spy: "${query}"${branchText}`);
            if (message.typingDelayMs) {
              await new Promise(r => setTimeout(r, message.typingDelayMs));
            }
          }

          // Check again after typing in case challenge was triggered
          if (isVerificationChallengePresent()) {
            showCaptchaPausedIndicator();
            sendResponse({
              success: false,
              captchaDetected: true,
              url: window.location.href,
            });
            return;
          }

          // 3. Extract real-time suggestions from Etsy same-origin API
          let suggestions = await fetchSameOriginSuggest(query);

          // 4. Also check live dropdown DOM to combine
          const domSuggestions = scrapeDropdownDOM();
          if (Array.isArray(domSuggestions) && domSuggestions.length > 0) {
            const combined = [...(suggestions || []), ...domSuggestions];
            suggestions = [...new Set(combined)];
          }

          sendResponse({ success: true, suggestions: suggestions || [] });
        } catch (err) {
          sendResponse({ success: false, suggestions: [], error: err?.message || 'Probe error' });
        }
      })();
      return true; // Keep channel open for async response
    }

    if (message.type === 'ETSY_SCAN_COMPLETE') {
      hideStatusIndicator();
      sendResponse({ success: true });
      return false;
    }

    return false;
  };

  window.__ekeywordspy_message_listener = messageListener;
  chrome.runtime.onMessage.addListener(messageListener);
})();
