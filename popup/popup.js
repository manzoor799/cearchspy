/**
 * E Keyword Spy — Popup UI Controller
 *
 * Modern SaaS Chrome Extension (Manifest V3) for Etsy Keyword Research.
 * Features:
 * - Multi-seed keyword batch queue
 * - Real-time live typing metrics & ETA calculation
 * - Dynamic data table with Etsy tag character counter (<=20c vs >20c)
 * - Directional filtering (All / After / Before) & seed scoping
 * - 1-Click CSV export & 13 Etsy Tags clipboard extraction
 * - Reactive local state via chrome.storage.local and chrome.storage.onChanged
 */

import { downloadCSV, copyToClipboard, copyEtsyTags } from '../lib/csv-export.js';
import { parseSeedKeywords } from '../lib/etsy-api.js';
import {
  getCurrentScan,
  getScanHistory,
  deleteScanFromHistory,
  clearAllHistory,
  getSettings,
  saveSettings,
} from '../lib/storage.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Application State
let currentResults = [];
let currentFilter = 'all'; // 'all' | 'autocomplete' | 'suffix' | 'prefix'
let currentSeedFilter = 'all'; // 'all' | specific seed keyword
let currentSearch = '';
let currentSeed = '';
let currentSeedList = [];
let selectedIndices = new Set();
let activeScanData = null;
let selectedBranchLimit = '3';

// Views
const views = {
  input: document.getElementById('view-input'),
  scanning: document.getElementById('view-scanning'),
  results: document.getElementById('view-results'),
  history: document.getElementById('view-history'),
};

// DOM Elements
const elements = {
  // Connection
  connectionBar: document.getElementById('connection-bar'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  btnHistory: document.getElementById('btn-history'),

  // View 1: Setup & Configuration
  seedKeyword: document.getElementById('seed-keyword'),
  seedBadge: document.getElementById('seed-badge'),
  cardDeepExpansion: document.getElementById('card-deep-expansion'),
  deepExpansionToggle: document.getElementById('deep-expansion-toggle'),
  deepOptionsContainer: document.getElementById('deep-options-container'),
  branchDepthGroup: document.getElementById('branch-depth-group'),
  inputError: document.getElementById('input-error'),
  incognitoCard: document.getElementById('incognito-card'),
  incognitoModeToggle: document.getElementById('incognito-mode-toggle'),
  testModeToggle: document.getElementById('test-mode-toggle'),
  btnStart: document.getElementById('btn-start'),

  // View 2: Live Scanning
  scanKeywordLabel: document.getElementById('scan-keyword-label'),
  scanModeLabel: document.getElementById('scan-mode-label'),
  btnCancel: document.getElementById('btn-cancel'),
  progressCounter: document.getElementById('progress-counter'),
  progressFill: document.getElementById('progress-fill'),
  statFound: document.getElementById('stat-found'),
  statQuery: document.getElementById('stat-query'),
  statEta: document.getElementById('stat-eta'),
  suffixSection: document.getElementById('suffix-section'),
  prefixSection: document.getElementById('prefix-section'),
  suffixGrid: document.getElementById('suffix-grid'),
  prefixGrid: document.getElementById('prefix-grid'),
  suffixLabel: document.getElementById('suffix-label'),
  prefixLabel: document.getElementById('prefix-label'),
  liveFeedList: document.getElementById('live-feed-list'),

  // View 3: Results & Data Table
  resultsKeywordLabel: document.getElementById('results-keyword-label'),
  resultsMeta: document.getElementById('results-meta'),
  btnResultsNew: document.getElementById('btn-results-new'),
  searchResults: document.getElementById('search-results'),
  filterSeed: document.getElementById('filter-seed'),
  tabAll: document.getElementById('tab-all'),
  tabAutocomplete: document.getElementById('tab-autocomplete'),
  tabSuffix: document.getElementById('tab-suffix'),
  tabPrefix: document.getElementById('tab-prefix'),
  selectAll: document.getElementById('select-all'),
  selectedCount: document.getElementById('selected-count'),
  resultsBody: document.getElementById('results-body'),
  btnCsv: document.getElementById('btn-csv'),
  btnCopyTags: document.getElementById('btn-copy-tags'),
  btnCopy: document.getElementById('btn-copy'),

  // View 4: History
  btnHistoryBack: document.getElementById('btn-history-back'),
  btnClearHistory: document.getElementById('btn-clear-history'),
  historyList: document.getElementById('history-list'),
  historyEmpty: document.getElementById('history-empty'),
  btnStartFirst: document.getElementById('btn-start-first'),

  // Notifications
  toast: document.getElementById('toast'),
};

/**
 * Switches the active UI view.
 * @param {'input'|'scanning'|'results'|'history'} viewName
 */
function switchView(viewName) {
  Object.keys(views).forEach(name => {
    if (views[name]) {
      views[name].classList.toggle('view--active', name === viewName);
    }
  });
}

/**
 * Displays a non-intrusive floating pill toast.
 * @param {string} message
 * @param {number} [duration]
 */
function showToast(message, duration = 2400) {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.classList.add('toast--visible');
  setTimeout(() => {
    elements.toast.classList.remove('toast--visible');
  }, duration);
}

// ==========================================
// INITIALIZATION & REHYDRATION
// ==========================================

async function initializeApp() {
  bindEvents();
  updateSeedBadge();
  await loadSavedSettings();
  await checkEtsyConnection();
  await rehydrateState();
}

function updateSeedBadge() {
  if (!elements.seedKeyword || !elements.seedBadge) return;
  const seeds = parseSeedKeywords(elements.seedKeyword.value);
  if (seeds.length <= 1) {
    elements.seedBadge.textContent = `${seeds.length || 0} keyword ready`;
  } else {
    elements.seedBadge.textContent = `${seeds.length} seeds in queue`;
  }
}

async function loadSavedSettings() {
  const settings = await getSettings();
  if (elements.testModeToggle) {
    elements.testModeToggle.checked = Boolean(settings.testMode);
  }
  if (elements.incognitoModeToggle) {
    elements.incognitoModeToggle.checked = (settings.useIncognito !== false);
  }
  if (elements.deepExpansionToggle) {
    elements.deepExpansionToggle.checked = (settings.deepExpansion !== false);
  }
  if (settings.branchLimit && elements.branchDepthGroup) {
    selectedBranchLimit = String(settings.branchLimit);
    elements.branchDepthGroup.querySelectorAll('.radio-pill').forEach(btn => {
      btn.classList.toggle('radio-pill--active', btn.dataset.depth === selectedBranchLimit);
    });
  }
}

async function checkEtsyConnection() {
  if (!elements.statusDot || !elements.statusText) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_ETSY_CONNECTION' });
    if (response?.connected) {
      elements.statusDot.className = 'status-dot status-dot--connected';
      if (response.isIncognito) {
        elements.statusText.textContent = 'Incognito Etsy Tab Connected (Clean Session)';
      } else {
        elements.statusText.textContent = 'Etsy Tab Connected (Live Search Bar)';
      }
    } else {
      elements.statusDot.className = 'status-dot status-dot--idle';
      if (elements.testModeToggle?.checked) {
        elements.statusText.textContent = 'Instant Test Mode (Ready)';
      } else if (elements.incognitoModeToggle?.checked) {
        elements.statusText.textContent = response?.isIncognitoAllowed
          ? 'Incognito Mode Ready (Opens upon start)'
          : 'Incognito not allowed in Chrome extension settings';
      } else {
        elements.statusText.textContent = 'Standalone Mode (Direct API)';
      }
    }
  } catch {
    elements.statusDot.className = 'status-dot status-dot--idle';
    elements.statusText.textContent = 'Ready';
  }
}

async function rehydrateState() {
  try {
    const current = await getCurrentScan();
    if (!current) {
      switchView('input');
      return;
    }

    if (current.status === 'running') {
      setupScanningView(current);
      switchView('scanning');
    } else if (current.status === 'completed' && current.results?.length > 0) {
      displayResults(current);
      switchView('results');
    } else {
      switchView('input');
    }
  } catch (err) {
    console.error('E Keyword Spy: rehydration error', err);
    switchView('input');
  }
}

// ==========================================
// SCANNING VIEW SETUP & PROGRESS
// ==========================================

function setupScanningView(scan) {
  activeScanData = scan;
  const currentSeed = scan.branchName || scan.currentSeed || scan.keyword || '';
  const seedIndex = scan.seedIndex || 1;
  const totalSeeds = scan.totalSeeds || 1;
  const totalBranches = scan.totalBranches || totalSeeds;
  const branchIndex = scan.branchIndex || seedIndex;

  if (elements.scanKeywordLabel) {
    if (scan.currentLetter === 'AUTO' || scan.statusMessage) {
      elements.scanKeywordLabel.textContent = scan.statusMessage || `Auto-Suggest Harvest: "${scan.currentSeed || scan.keyword}"`;
    } else {
      elements.scanKeywordLabel.textContent = `Scanning: "${currentSeed}"`;
    }
  }
  if (elements.scanModeLabel) {
    if (scan.currentLetter === 'AUTO') {
      elements.scanModeLabel.textContent = 'Harvesting Etsy search bar autocomplete...';
    } else {
      const branchPrefixText = totalBranches > 1 ? `Branch ${branchIndex} of ${totalBranches} · ` : (totalSeeds > 1 ? `Seed ${seedIndex} of ${totalSeeds} · ` : '');
      elements.scanModeLabel.textContent = `${branchPrefixText}${scan.mode.toUpperCase()} mode`;
    }
  }
  if (elements.suffixLabel) elements.suffixLabel.textContent = currentSeed;
  if (elements.prefixLabel) elements.prefixLabel.textContent = currentSeed;

  if (elements.suffixSection) {
    elements.suffixSection.style.display = (scan.mode === 'prefix') ? 'none' : 'block';
  }
  if (elements.prefixSection) {
    elements.prefixSection.style.display = (scan.mode === 'suffix') ? 'none' : 'block';
  }

  if (elements.suffixGrid) {
    renderLetterGrid(elements.suffixGrid, scan.currentLetter, scan.currentType === 'suffix');
  }
  if (elements.prefixGrid) {
    renderLetterGrid(elements.prefixGrid, scan.currentLetter, scan.currentType === 'prefix');
  }

  updateScanningProgress({
    overallStep: scan.currentStep || 0,
    totalOverallSteps: scan.totalSteps || 52,
    currentSeed: scan.currentSeed || currentSeed,
    seedIndex,
    totalSeeds,
    branchName: scan.branchName || currentSeed,
    branchIndex,
    totalBranches,
    rootSeed: scan.rootSeed || scan.currentSeed,
    letter: scan.currentLetter || 'A',
    type: scan.currentType || 'suffix',
    statusMessage: scan.statusMessage,
    newResults: [],
    totalFound: scan.results?.length || 0,
  });

  if (elements.liveFeedList) {
    elements.liveFeedList.innerHTML = '';
    if (scan.results && scan.results.length > 0) {
      const recent = scan.results.slice(-15);
      recent.forEach(r => appendLiveFeedItem(r));
    }
  }
}

function renderLetterGrid(container, activeLetter, isThisTypeActive) {
  if (!container) return;
  container.innerHTML = '';
  const activeCode = (activeLetter || 'A').toUpperCase().charCodeAt(0);

  ALPHABET.forEach(letter => {
    const span = document.createElement('span');
    span.className = 'letter';
    span.textContent = letter;
    span.dataset.letter = letter;

    const letterCode = letter.charCodeAt(0);
    if (!isThisTypeActive) {
      span.classList.add('letter--pending');
    } else if (letterCode < activeCode) {
      span.classList.add('letter--done');
    } else if (letterCode === activeCode) {
      span.classList.add('letter--active');
    } else {
      span.classList.add('letter--pending');
    }

    container.appendChild(span);
  });
}

function updateScanningProgress(progress) {
  const percent = progress.totalOverallSteps > 0
    ? Math.min(100, Math.round((progress.overallStep / progress.totalOverallSteps) * 100))
    : 0;

  const branchText = progress.totalBranches > 1 ? ` (Branch ${progress.branchIndex || 1}/${progress.totalBranches})` : '';
  if (elements.progressCounter) {
    elements.progressCounter.textContent = `${progress.overallStep} / ${progress.totalOverallSteps} queries${branchText}`;
  }
  if (elements.progressFill) {
    elements.progressFill.style.width = `${percent}%`;
  }

  const activeSeed = progress.branchName || progress.currentSeed || '';
  if (activeSeed) {
    if (elements.scanKeywordLabel) {
      if (progress.letter === 'AUTO' || progress.statusMessage) {
        elements.scanKeywordLabel.textContent = progress.statusMessage || `Auto-Suggest Harvest: "${progress.currentSeed}"`;
      } else {
        elements.scanKeywordLabel.textContent = `Scanning: "${activeSeed}"`;
      }
    }
    if (elements.suffixLabel) elements.suffixLabel.textContent = activeSeed;
    if (elements.prefixLabel) elements.prefixLabel.textContent = activeSeed;
  }

  if (elements.scanModeLabel) {
    if (progress.letter === 'AUTO') {
      elements.scanModeLabel.textContent = 'Capturing Etsy search bar autocomplete...';
    } else {
      const branchPrefixText = progress.totalBranches > 1
        ? `Branch ${progress.branchIndex} of ${progress.totalBranches} · `
        : (progress.totalSeeds > 1 ? `Seed ${progress.seedIndex} of ${progress.totalSeeds} · ` : '');
      const typeLabel = progress.type ? progress.type.toUpperCase() : 'SCAN';
      elements.scanModeLabel.textContent = `${branchPrefixText}${typeLabel} mode`;
    }
  }

  if (elements.statFound) {
    elements.statFound.textContent = String(progress.totalFound);
  }
  if (elements.statQuery) {
    if (progress.letter === 'AUTO') {
      elements.statQuery.textContent = 'AUTO';
    } else {
      const dirLabel = progress.type === 'suffix' ? 'After' : 'Before';
      elements.statQuery.textContent = `${progress.letter} (${dirLabel})`;
    }
  }
  if (elements.statEta) {
    const remaining = Math.max(0, progress.totalOverallSteps - progress.overallStep);
    const estSeconds = Math.ceil(remaining * 0.08);
    elements.statEta.textContent = estSeconds <= 1 ? '<1s' : `~${estSeconds}s`;
  }

  if (progress.letter !== 'AUTO') {
    updateLetterInGrid(elements.suffixGrid, progress.letter, progress.type === 'suffix');
    updateLetterInGrid(elements.prefixGrid, progress.letter, progress.type === 'prefix');
  }

  if (progress.newResults && progress.newResults.length > 0) {
    progress.newResults.forEach(r => appendLiveFeedItem(r));
  }
}

function updateLetterInGrid(grid, activeLetter, isActiveType) {
  if (!grid) return;
  const activeCode = (activeLetter || 'A').toUpperCase().charCodeAt(0);

  grid.querySelectorAll('.letter').forEach(el => {
    const letter = el.dataset.letter;
    const letterCode = letter.charCodeAt(0);

    el.className = 'letter';
    if (!isActiveType) {
      if (grid === elements.suffixGrid) {
        el.classList.add('letter--done');
      } else {
        el.classList.add('letter--pending');
      }
    } else {
      if (letterCode < activeCode) {
        el.classList.add('letter--done');
      } else if (letterCode === activeCode) {
        el.classList.add('letter--active');
      } else {
        el.classList.add('letter--pending');
      }
    }
  });
}

function appendLiveFeedItem(item) {
  if (!elements.liveFeedList) return;
  const row = document.createElement('div');
  row.className = 'live-item';
  const seedTag = item.seedKeyword ? ` <small style="color:var(--text-muted);">(${escapeHTML(item.seedKeyword)})</small>` : '';
  row.innerHTML = `
    <span class="live-item__keyword">${escapeHTML(item.keyword)}${seedTag}</span>
    <span class="live-item__source">${escapeHTML(item.source)}</span>
  `;
  elements.liveFeedList.prepend(row);
}

// ==========================================
// RESULTS VIEW & MULTI-SEED FILTERING
// ==========================================

function displayResults(scan) {
  currentResults = scan.results || [];
  currentSeed = scan.keyword || '';
  currentSeedList = scan.seedList || (currentSeed ? currentSeed.split(', ') : []);
  currentSearch = '';
  currentFilter = 'all';
  currentSeedFilter = 'all';

  if (elements.resultsKeywordLabel) {
    if (currentSeedList.length > 1) {
      elements.resultsKeywordLabel.textContent = `${currentSeedList.length} Seeds in Batch`;
    } else {
      elements.resultsKeywordLabel.textContent = `"${currentSeed}"`;
    }
  }

  if (elements.resultsMeta) {
    const dateStr = scan.endTime ? new Date(scan.endTime).toLocaleDateString() : 'Today';
    elements.resultsMeta.textContent = `${currentResults.length} keywords found · ${dateStr}`;
  }

  if (elements.searchResults) elements.searchResults.value = '';
  selectedIndices = new Set(currentResults.map((_, i) => i));

  populateSeedDropdown();
  updateFilterTabs();
  renderResultsTable();
}

function populateSeedDropdown() {
  if (!elements.filterSeed) return;
  elements.filterSeed.innerHTML = `<option value="all">All Seeds (${currentResults.length})</option>`;

  const seedCounts = new Map();
  currentResults.forEach(r => {
    const s = r.seedKeyword || currentSeed;
    seedCounts.set(s, (seedCounts.get(s) || 0) + 1);
  });

  if (seedCounts.size > 1) {
    elements.filterSeed.style.display = 'block';
    seedCounts.forEach((count, seed) => {
      const opt = document.createElement('option');
      opt.value = seed;
      opt.textContent = `${seed} (${count})`;
      elements.filterSeed.appendChild(opt);
    });
  } else {
    elements.filterSeed.style.display = 'none';
  }
}

function updateFilterTabs() {
  const filteredBySeed = currentSeedFilter === 'all'
    ? currentResults
    : currentResults.filter(r => (r.seedKeyword || currentSeed) === currentSeedFilter);

  const autocompleteCount = filteredBySeed.filter(r => r.type === 'autocomplete').length;
  const suffixCount = filteredBySeed.filter(r => r.type === 'suffix').length;
  const prefixCount = filteredBySeed.filter(r => r.type === 'prefix').length;

  if (elements.tabAll) elements.tabAll.textContent = `All (${filteredBySeed.length})`;
  if (elements.tabAutocomplete) elements.tabAutocomplete.textContent = `Auto-Suggest (${autocompleteCount})`;
  if (elements.tabSuffix) elements.tabSuffix.textContent = `After (${suffixCount})`;
  if (elements.tabPrefix) elements.tabPrefix.textContent = `Before (${prefixCount})`;

  document.querySelectorAll('.seg-tab').forEach(t => {
    t.classList.toggle('seg-tab--active', t.dataset.filter === currentFilter);
  });
}

function getFilteredResults() {
  return currentResults.filter((item) => {
    if (currentSeedFilter !== 'all') {
      const seed = item.seedKeyword || currentSeed;
      if (seed !== currentSeedFilter) return false;
    }
    if (currentFilter !== 'all' && item.type !== currentFilter) {
      return false;
    }
    if (currentSearch.trim()) {
      const q = currentSearch.trim().toLowerCase();
      const inKeyword = item.keyword.toLowerCase().includes(q);
      const inSource = (item.source || '').toLowerCase().includes(q);
      const inSeed = (item.seedKeyword || '').toLowerCase().includes(q);
      return inKeyword || inSource || inSeed;
    }
    return true;
  });
}

function renderResultsTable() {
  if (!elements.resultsBody) return;
  const filtered = getFilteredResults();
  elements.resultsBody.innerHTML = '';

  if (filtered.length === 0) {
    elements.resultsBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;padding:28px 16px;color:var(--text-muted);font-size:12px;">
          No matching keywords found.
        </td>
      </tr>
    `;
    if (elements.selectedCount) elements.selectedCount.textContent = '0 selected';
    return;
  }

  const fragment = document.createDocumentFragment();

  filtered.forEach((item, index) => {
    const tr = document.createElement('tr');
    const originalIndex = currentResults.indexOf(item);
    const isChecked = selectedIndices.has(originalIndex);

    const len = (item.keyword || '').length;
    let tagBadgeClass = 'tag-badge--fit';
    let tagTitle = `${len} characters (Fits within Etsy 20-character tag limit)`;

    if (len > 20) {
      tagBadgeClass = 'tag-badge--long';
      tagTitle = `${len} characters (Exceeds Etsy 20-char tag limit - recommended for title/listing copy)`;
    } else if (len >= 18) {
      tagBadgeClass = 'tag-badge--warn';
      tagTitle = `${len} characters (Near Etsy 20-character tag limit)`;
    }

    const isAuto = item.type === 'autocomplete';
    const seedLabel = isAuto ? 'Auto-Suggest' : (item.seedKeyword || currentSeed);
    const seedChipClass = isAuto ? 'seed-chip seed-chip--auto' : 'seed-chip';
    const seedTitle = item.seedKeyword ? `Seed: ${item.seedKeyword}` : seedLabel;
    const etsySearchUrl = `https://www.etsy.com/search?q=${encodeURIComponent(item.keyword)}`;

    tr.innerHTML = `
      <td class="col-check">
        <input type="checkbox" data-index="${originalIndex}" ${isChecked ? 'checked' : ''} aria-label="Select keyword">
      </td>
      <td class="col-num">${index + 1}</td>
      <td class="col-keyword">${escapeHTML(item.keyword)}</td>
      <td class="col-tag">
        <span class="tag-badge ${tagBadgeClass}" title="${tagTitle}">${len}c</span>
      </td>
      <td class="col-seed">
        <span class="${seedChipClass}" title="${escapeHTML(seedTitle)}">${escapeHTML(seedLabel)}</span>
      </td>
      <td class="col-link">
        <a class="ext-link" href="${etsySearchUrl}" target="_blank" rel="noopener" title="Search on Etsy">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </a>
      </td>
    `;

    fragment.appendChild(tr);
  });

  elements.resultsBody.appendChild(fragment);
  updateSelectedCountDisplay();
}

function updateSelectedCountDisplay() {
  if (!elements.selectedCount || !elements.selectAll) return;
  const filtered = getFilteredResults();
  const visibleSelected = filtered.filter(item => {
    const idx = currentResults.indexOf(item);
    return selectedIndices.has(idx);
  }).length;

  elements.selectedCount.textContent = `${visibleSelected} of ${filtered.length} selected`;
  elements.selectAll.checked = (visibleSelected === filtered.length && filtered.length > 0);
}

// ==========================================
// HISTORY VIEW
// ==========================================

async function loadHistoryView() {
  if (!elements.historyList) return;
  const history = await getScanHistory();
  elements.historyList.innerHTML = '';

  if (!history || history.length === 0) {
    if (elements.historyEmpty) elements.historyEmpty.style.display = 'flex';
    if (elements.btnClearHistory) elements.btnClearHistory.style.display = 'none';
    return;
  }

  if (elements.historyEmpty) elements.historyEmpty.style.display = 'none';
  if (elements.btnClearHistory) elements.btnClearHistory.style.display = 'block';

  history.forEach(scan => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const count = scan.results?.length || 0;
    const dateStr = scan.startTime ? new Date(scan.startTime).toLocaleDateString() : '';
    const seedText = scan.seedList?.length > 1
      ? `${scan.seedList.length} Seeds: ${scan.keyword}`
      : scan.keyword;

    card.innerHTML = `
      <div style="flex:1;min-width:0;">
        <div class="history-card__kw">${escapeHTML(seedText)}</div>
        <div class="history-card__meta">${dateStr} · ${scan.mode.toUpperCase()}</div>
      </div>
      <div class="history-card__right">
        <span class="history-card__count">${count}</span>
        <button class="history-card__del" data-id="${scan.id}" title="Delete scan" aria-label="Delete scan">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.history-card__del')) return;
      displayResults(scan);
      switchView('results');
    });

    const delBtn = card.querySelector('.history-card__del');
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteScanFromHistory(scan.id);
      await loadHistoryView();
      showToast('Scan deleted from history');
    });

    elements.historyList.appendChild(card);
  });
}

// ==========================================
// EVENT HANDLERS
// ==========================================

function bindEvents() {
  // Real-time Seed Count Badge on Typing
  if (elements.seedKeyword) {
    elements.seedKeyword.addEventListener('input', updateSeedBadge);
    elements.seedKeyword.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        handleStartScanClick();
      }
    });
  }

  // Quick Preset Chips (1-Click Idea buttons)
  document.querySelectorAll('.preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const kw = btn.dataset.keyword;
      if (elements.seedKeyword && kw) {
        elements.seedKeyword.value = kw;
        updateSeedBadge();
        showToast(`Selected "${kw}"`);
      }
    });
  });

  // Deep Auto-Suggest Expansion Toggle & Branch Depth Pills
  if (elements.deepExpansionToggle) {
    elements.deepExpansionToggle.addEventListener('change', (e) => {
      if (elements.deepOptionsContainer) {
        elements.deepOptionsContainer.style.opacity = e.target.checked ? '1' : '0.4';
        elements.deepOptionsContainer.style.pointerEvents = e.target.checked ? 'auto' : 'none';
      }
    });
  }

  if (elements.branchDepthGroup) {
    elements.branchDepthGroup.querySelectorAll('.radio-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        elements.branchDepthGroup.querySelectorAll('.radio-pill').forEach(b => b.classList.remove('radio-pill--active'));
        btn.classList.add('radio-pill--active');
        selectedBranchLimit = btn.dataset.depth;
        showToast(`Branch depth: ${btn.textContent.trim()}`);
      });
    });
  }

  // Start Scan CTA
  if (elements.btnStart) {
    elements.btnStart.addEventListener('click', handleStartScanClick);
  }

  // Cancel Scan CTA
  if (elements.btnCancel) {
    elements.btnCancel.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'CANCEL_SCAN' });
    });
  }

  // Incognito Mode Toggle
  if (elements.incognitoModeToggle) {
    elements.incognitoModeToggle.addEventListener('change', async (e) => {
      await saveSettings({ useIncognito: e.target.checked });
      await checkEtsyConnection();
      showToast(e.target.checked ? 'Incognito Mode enabled' : 'Incognito Mode disabled');
    });
  }

  // Instant Test Mode Toggle
  if (elements.testModeToggle) {
    elements.testModeToggle.addEventListener('change', async (e) => {
      await saveSettings({ testMode: e.target.checked });
      await checkEtsyConnection();
    });
  }

  // Keyword Search Results Filter
  if (elements.searchResults) {
    elements.searchResults.addEventListener('input', (e) => {
      currentSearch = e.target.value;
      renderResultsTable();
    });
  }

  // Seed Filter Dropdown
  if (elements.filterSeed) {
    elements.filterSeed.addEventListener('change', (e) => {
      currentSeedFilter = e.target.value;
      updateFilterTabs();
      renderResultsTable();
    });
  }

  // Segmented Direction Filter Tabs
  document.querySelectorAll('.seg-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentFilter = tab.dataset.filter;
      updateFilterTabs();
      renderResultsTable();
    });
  });

  // Select All Checkbox
  if (elements.selectAll) {
    elements.selectAll.addEventListener('change', (e) => {
      const checked = e.target.checked;
      const filtered = getFilteredResults();
      filtered.forEach(item => {
        const idx = currentResults.indexOf(item);
        if (checked) {
          selectedIndices.add(idx);
        } else {
          selectedIndices.delete(idx);
        }
      });
      renderResultsTable();
    });
  }

  // Individual Table Checkboxes
  if (elements.resultsBody) {
    elements.resultsBody.addEventListener('change', (e) => {
      if (e.target.type === 'checkbox') {
        const idx = parseInt(e.target.dataset.index, 10);
        if (e.target.checked) {
          selectedIndices.add(idx);
        } else {
          selectedIndices.delete(idx);
        }
        updateSelectedCountDisplay();
      }
    });
  }

  // CSV Export Button
  if (elements.btnCsv) {
    elements.btnCsv.addEventListener('click', () => {
      const exportItems = currentResults.filter((_, i) => selectedIndices.has(i));
      if (exportItems.length === 0) {
        showToast('No keywords selected');
        return;
      }
      try {
        const filename = downloadCSV(exportItems, currentSeed);
        showToast(`Downloaded ${filename}`);
      } catch (err) {
        showToast(`Error: ${err.message}`);
      }
    });
  }

  // Copy 13 Etsy Tags Button (<=20 chars)
  if (elements.btnCopyTags) {
    elements.btnCopyTags.addEventListener('click', async () => {
      const candidateItems = currentResults.filter((_, i) => selectedIndices.has(i));
      const pool = candidateItems.length > 0 ? candidateItems : currentResults;
      const count = await copyEtsyTags(pool, 13);
      if (count === 0) {
        showToast('No tags found under 20 characters');
      } else {
        showToast(`Copied ${count} tags formatted for Etsy`);
      }
    });
  }

  // Copy All Selected Keywords Button
  if (elements.btnCopy) {
    elements.btnCopy.addEventListener('click', async () => {
      const copyItems = currentResults.filter((_, i) => selectedIndices.has(i));
      if (copyItems.length === 0) {
        showToast('No keywords selected');
        return;
      }
      const count = await copyToClipboard(copyItems);
      showToast(`Copied ${count} keywords to clipboard`);
    });
  }

  // New Scan Button
  if (elements.btnResultsNew) {
    elements.btnResultsNew.addEventListener('click', () => {
      switchView('input');
    });
  }

  // History Navigation
  if (elements.btnHistory) {
    elements.btnHistory.addEventListener('click', async () => {
      await loadHistoryView();
      switchView('history');
    });
  }

  if (elements.btnHistoryBack) {
    elements.btnHistoryBack.addEventListener('click', () => {
      switchView('input');
    });
  }

  if (elements.btnStartFirst) {
    elements.btnStartFirst.addEventListener('click', () => {
      switchView('input');
    });
  }

  if (elements.btnClearHistory) {
    elements.btnClearHistory.addEventListener('click', async () => {
      if (confirm('Clear all scan history?')) {
        await clearAllHistory();
        await loadHistoryView();
        showToast('History cleared');
      }
    });
  }

  // Message Listener from Background Worker
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'SCAN_STARTED':
        setupScanningView(message.scan);
        switchView('scanning');
        break;

      case 'SCAN_PROGRESS':
        updateScanningProgress(message.progress);
        break;

      case 'SCAN_COMPLETED':
        displayResults(message.scan);
        switchView('results');
        showToast(`Scan complete. Found ${message.scan.results.length} keywords.`);
        break;

      case 'SCAN_CANCELLED':
        showToast('Scan cancelled');
        switchView('input');
        break;

      case 'SCAN_ERROR':
        showToast(`Scan error: ${message.error}`);
        switchView('input');
        break;
    }
  });

  // Reactive Storage State Listener
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const scanChange = changes.cearchspy_current_scan || changes.ekeywordspy_current_scan;
    if (scanChange) {
      const next = scanChange.newValue;
      if (!next) {
        if (!views.input.classList.contains('view--active')) {
          switchView('input');
        }
      } else if (next.status === 'running') {
        if (!views.scanning.classList.contains('view--active')) {
          setupScanningView(next);
          switchView('scanning');
        }
      }
    }
  });
}

async function handleStartScanClick() {
  const rawKeywords = elements.seedKeyword.value.trim();
  const seedList = parseSeedKeywords(rawKeywords);

  if (seedList.length === 0) {
    elements.inputError.textContent = 'Please enter at least one seed keyword.';
    elements.seedKeyword.classList.add('text-input--error');
    elements.seedKeyword.focus();
    return;
  }

  elements.inputError.textContent = '';
  elements.seedKeyword.classList.remove('text-input--error');

  const mode = document.querySelector('input[name="scan-mode"]:checked')?.value || 'both';
  const testMode = elements.testModeToggle?.checked || false;
  const deepExpansion = elements.deepExpansionToggle ? elements.deepExpansionToggle.checked : true;
  const branchLimit = selectedBranchLimit;
  const useIncognito = elements.incognitoModeToggle ? elements.incognitoModeToggle.checked : true;

  try {
    await chrome.runtime.sendMessage({
      type: 'START_SCAN',
      payload: { keywords: seedList, mode, testMode, deepExpansion, branchLimit, useIncognito },
    });
  } catch (err) {
    showToast(`Failed to start scan: ${err.message}`);
  }
}

function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Boot application
initializeApp();
