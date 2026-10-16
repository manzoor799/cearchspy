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
  // Prevent duplicate injection
  if (window.__ekeywordspy_injected) return;
  window.__ekeywordspy_injected = true;

  let activeIndicator = null;
  let activeSearchInput = null;

  /**
   * Finds Etsy's main search input element on the page.
   * @returns {HTMLInputElement|null}
   */
  /**
   * Finds Etsy's main search input element on the page.
   * Supports all variations across desktop, tablet, and responsive headers.
   * @returns {HTMLInputElement|null}
   */
  function findSearchInput() {
    return document.querySelector(
      '#global-enhancements-search-query, input[name="search_query"], input[data-id="search-query"], input[placeholder*="Search for anything"], input[type="search"], input[aria-label*="Search"]'
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
        const res = await fetch(url, {
          headers: {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
          credentials: 'same-origin',
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
   * Detects whether Etsy or DataDome has displayed a genuine CAPTCHA / slider verification challenge.
   * Prevents false positives when Etsy's homepage and search bar are healthy.
   * @returns {boolean}
   */
  function isVerificationChallengePresent() {
    try {
      const url = window.location.href || '';
      const title = document.title || '';

      // 1. Check URL query & hash for explicit DataDome challenge redirect
      if (url.includes('dd_referrer=') || url.includes('captcha-delivery.com') || url.includes('datadome.co')) {
        return true;
      }

      // 2. Check for active DataDome challenge iframe in DOM
      const captchaIframe = document.querySelector(
        'iframe[src*="captcha-delivery.com"], iframe[src*="datadome"], iframe[title*="DataDome"], iframe[title*="Captcha"]'
      );
      if (captchaIframe) return true;

      // 3. Check for specific DataDome slider container
      const sliderBox = document.querySelector('.datadome-slider, #dd-captcha, [data-dd-captcha], #captcha-box');
      if (sliderBox && sliderBox.offsetHeight > 0) return true;

      // 4. If Etsy's genuine search bar is present and accessible, page is healthy!
      const searchInput = findSearchInput();
      if (searchInput) {
        return false;
      }

      // 5. If NO search bar exists, check if title indicates a bot block
      const lowerTitle = title.toLowerCase();
      if (
        lowerTitle.includes('robot or human') ||
        lowerTitle.includes('datadome') ||
        (lowerTitle.includes('verification required') && !lowerTitle.includes('shop'))
      ) {
        return true;
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

  // Runtime Message Listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ETSY_PING') {
      const challenged = isVerificationChallengePresent();
      sendResponse({ success: true, url: window.location.href, challenged });
      return false;
    }

    if (message.type === 'CHECK_VERIFICATION_RESOLVED') {
      const challenged = isVerificationChallengePresent();
      const hasSearchInput = Boolean(findSearchInput());
      if (!challenged) {
        hideStatusIndicator();
      }
      sendResponse({
        resolved: !challenged,
        captchaDetected: challenged,
        hasSearchInput,
        url: window.location.href,
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
      })();
      return true; // Keep channel open for async response
    }

    if (message.type === 'ETSY_SCAN_COMPLETE') {
      hideStatusIndicator();
      sendResponse({ success: true });
      return false;
    }

    return false;
  });
})();
