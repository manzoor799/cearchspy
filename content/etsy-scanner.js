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
  function findSearchInput() {
    return document.querySelector(
      '#global-enhancements-search-query, input[name="search_query"], input[data-id="search-query"], input[placeholder*="Search for anything"], input[type="search"]'
    );
  }

  /**
   * Visually types the query into Etsy's search input with live focus and input events.
   * Uses brand primary (#4032C9) for the active outline.
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

    input.style.border = '1px solid #4032C9';
    input.style.boxShadow = '0 0 0 3px rgba(64, 50, 201, 0.18)';
    input.style.transition = 'all 0.16s ease';

    // Set text value
    input.value = query;

    // Dispatch DOM events so Etsy's internal listeners detect user input
    try {
      input.focus();
      input.dispatchEvent(new Event('focus', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const lastChar = query.slice(-1);
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: lastChar }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: lastChar }));
    } catch {
      // Event dispatch error fallback
    }

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
        transition: 'all 0.16s ease',
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
   * Directly queries Etsy's real-time autocomplete index.
   * @param {string} query
   * @returns {Promise<string[]>}
   */
  async function fetchSameOriginSuggest(query) {
    try {
      const url = `/search/suggest?q=${encodeURIComponent(query)}&lang=en-US`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!res.ok) return [];
      const data = await res.json();

      if (Array.isArray(data)) {
        if (typeof data[0] === 'string') return data;
        return data.map(item => item?.query || item?.text || '').filter(Boolean);
      }
      if (data && typeof data === 'object') {
        const list = data.results || data.suggestions || data.queries || [];
        if (Array.isArray(list)) {
          return list.map(item => (typeof item === 'string' ? item : item?.query || item?.text || '')).filter(Boolean);
        }
      }
    } catch {
      // Fallback
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
      '#global-enhancements-search-suggestions, [data-search-suggestions], [data-ui="autocomplete-results"], div[role="listbox"], ul[role="listbox"]'
    );
    if (!container) return suggestions;

    const items = container.querySelectorAll('li, div[role="option"], [data-suggestion]');
    for (const item of items) {
      // Skip trending items with thumbnails (under "Top searches this week")
      if (item.querySelector('img')) continue;

      const text = item.textContent || '';
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean && !clean.toLowerCase().includes('find shop names')) {
        suggestions.push(clean);
      }
    }

    return suggestions;
  }

  // Runtime Message Listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ETSY_PING') {
      sendResponse({ success: true, url: window.location.href });
      return false;
    }

    if (message.type === 'ETSY_SCAN_PROBE') {
      (async () => {
        const query = message.query;
        const seedIndex = message.seedIndex || 1;
        const totalSeeds = message.totalSeeds || 1;
        const seedText = totalSeeds > 1 ? ` (Seed ${seedIndex}/${totalSeeds})` : '';

        // 1. Physically type into Etsy's search bar with live movement
        typeIntoEtsySearchBar(query);

        // 2. Update HUD overlay
        showStatusIndicator(`E Keyword Spy: "${query}"${seedText}`);

        // 3. Extract real-time suggestions from Etsy same-origin API
        let suggestions = await fetchSameOriginSuggest(query);

        // 4. Also check live dropdown DOM to combine
        if (!suggestions || suggestions.length === 0) {
          suggestions = scrapeDropdownDOM();
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
