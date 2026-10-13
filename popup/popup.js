/**
 * CearchSpy — Popup UI Controller
 *
 * Manages UI states, user inputs, multi-seed batch queues, live progress updates,
 * table filtering with seed selector, Etsy tag length analysis, CSV export,
 * and history navigation.
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

// App State
let currentResults = [];
let currentFilter = 'all'; // 'all' | 'suffix' | 'prefix'
let currentSeedFilter = 'all'; // 'all' | specific seed keyword
let currentSearch = '';
let currentSeed = '';
let currentSeedList = [];
let selectedIndices = new Set();
let activeScanData = null;

// DOM Elements
const views = {
  input: document.getElementById('view-input'),
  scanning: document.getElementById('view-scanning'),
  results: document.getElementById('view-results'),
  history: document.getElementById('view-history'),
};

const elements = {
  // Input
  seedKeyword: document.getElementById('seed-keyword'),
  seedBadge: document.getElementById('seed-badge'),
  inputError: document.getElementById('input-error'),
  btnStart: document.getElementById('btn-start'),
  testModeToggle: document.getElementById('test-mode-toggle'),
  connectionBar: document.getElementById('connection-bar'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  btnHistory: document.getElementById('btn-history'),

  // Scanning
  scanKeywordLabel: document.getElementById('scan-keyword-label'),
  scanModeLabel: document.getElementById('scan-mode-label'),
  btnCancel: document.getElementById('btn-cancel'),
  progressCounter: document.getElementById('progress-counter'),
  progressFill: document.getElementById('progress-fill'),
  suffixSection: document.getElementById('suffix-section'),
  prefixSection: document.getElementById('prefix-section'),
  suffixGrid: document.getElementById('suffix-grid'),
  prefixGrid: document.getElementById('prefix-grid'),
  suffixLabel: document.getElementById('suffix-label'),
  prefixLabel: document.getElementById('prefix-label'),
  statFound: document.getElementById('stat-found'),
  statQuery: document.getElementById('stat-query'),
  liveFeedList: document.getElementById('live-feed-list'),

  // Results
  resultsKeywordLabel: document.getElementById('results-keyword-label'),
  resultsMeta: document.getElementById('results-meta'),
  btnResultsNew: document.getElementById('btn-results-new'),
  searchResults: document.getElementById('search-results'),
  filterSeed: document.getElementById('filter-seed'),
  tabAll: document.getElementById('tab-all'),
  tabSuffix: document.getElementById('tab-suffix'),
  tabPrefix: document.getElementById('tab-prefix'),
  selectAll: document.getElementById('select-all'),
  selectedCount: document.getElementById('selected-count'),
  resultsBody: document.getElementById('results-body'),
  btnCsv: document.getElementById('btn-csv'),
  btnCopyTags: document.getElementById('btn-copy-tags'),
  btnCopy: document.getElementById('btn-copy'),

  // History
  btnHistoryBack: document.getElementById('btn-history-back'),
  btnClearHistory: document.getElementById('btn-clear-history'),
  historyList: document.getElementById('history-list'),
  historyEmpty: document.getElementById('history-empty'),
  btnStartFirst: document.getElementById('btn-start-first'),

  // Toast
  toast: document.getElementById('toast'),
};

/**
 * Switches the active UI view.
 * @param {'input'|'scanning'|'results'|'history'} viewName
 */
function switchView(viewName) {
  Object.keys(views).forEach(name => {
    views[name].classList.toggle('view--active', name === viewName);
  });
}

/**
 * Displays a non-intrusive toast message.
 * @param {string} message
 * @param {number} [duration]
 */
function showToast(message, duration = 2500) {
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
  const seeds = parseSeedKeywords(elements.seedKeyword.value);
  if (seeds.length <= 1) {
    elements.seedBadge.textContent = `${seeds.length || 0} keyword`;
  } else {
    elements.seedBadge.textContent = `${seeds.length} seeds in queue`;
  }
}

async function loadSavedSettings() {
  const settings = await getSettings();
  if (elements.testModeToggle) {
    elements.testModeToggle.checked = Boolean(settings.testMode);
  }
}

async function checkEtsyConnection() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_ETSY_CONNECTION' });
    if (response?.connected) {
      elements.statusDot.className = 'status-dot status-dot--connected';
      elements.statusText.textContent = '🟢 Etsy Tab Connected (Live Search Bar Automation)';
    } else {
      elements.statusDot.className = 'status-dot status-dot--idle';
      elements.statusText.textContent = elements.testModeToggle.checked
        ? '⚡ Instant Test Mode (Ready)'
        : '⚪ Standalone Mode (Direct API)';
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
    console.error('CearchSpy: rehydration error', err);
    switchView('input');
  }
}

// ==========================================
// SCANNING VIEW SETUP & UPDATES
// ==========================================

function setupScanningView(scan) {
  activeScanData = scan;
  const currentSeed = scan.currentSeed || scan.keyword || '';
  const seedIndex = scan.seedIndex || 1;
  const totalSeeds = scan.totalSeeds || 1;

  elements.scanKeywordLabel.textContent = `Scanning: "${currentSeed}"`;
  const seedPrefixText = totalSeeds > 1 ? `Seed ${seedIndex} of ${totalSeeds} · ` : '';
  elements.scanModeLabel.textContent = `${seedPrefixText}${scan.mode.toUpperCase()} mode`;
  elements.suffixLabel.textContent = currentSeed;
  elements.prefixLabel.textContent = currentSeed;

  elements.suffixSection.style.display = (scan.mode === 'prefix') ? 'none' : 'block';
  elements.prefixSection.style.display = (scan.mode === 'suffix') ? 'none' : 'block';

  renderLetterGrid(elements.suffixGrid, scan.currentLetter, scan.currentType === 'suffix');
  renderLetterGrid(elements.prefixGrid, scan.currentLetter, scan.currentType === 'prefix');

  updateScanningProgress({
    overallStep: scan.currentStep || 0,
    totalOverallSteps: scan.totalSteps || 52,
    currentSeed,
    seedIndex,
    totalSeeds,
    letter: scan.currentLetter || 'A',
    type: scan.currentType || 'suffix',
    newResults: [],
    totalFound: scan.results?.length || 0,
  });

  elements.liveFeedList.innerHTML = '';
  if (scan.results && scan.results.length > 0) {
    const recent = scan.results.slice(-15);
    recent.forEach(r => appendLiveFeedItem(r));
  }
}

function renderLetterGrid(container, activeLetter, isThisTypeActive) {
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

  elements.progressCounter.textContent = `${progress.overallStep} / ${progress.totalOverallSteps}`;
  elements.progressFill.style.width = `${percent}%`;

  if (progress.currentSeed) {
    elements.scanKeywordLabel.textContent = `Scanning: "${progress.currentSeed}"`;
    elements.suffixLabel.textContent = progress.currentSeed;
    elements.prefixLabel.textContent = progress.currentSeed;
  }

  const seedPrefixText = progress.totalSeeds > 1
    ? `Seed ${progress.seedIndex} of ${progress.totalSeeds} · `
    : '';
  elements.scanModeLabel.textContent = `${seedPrefixText}${progress.type.toUpperCase()} mode`;

  elements.statFound.textContent = String(progress.totalFound);
  elements.statQuery.textContent = `${progress.letter} (${progress.type === 'suffix' ? 'Suf' : 'Pre'})`;

  updateLetterInGrid(elements.suffixGrid, progress.letter, progress.type === 'suffix');
  updateLetterInGrid(elements.prefixGrid, progress.letter, progress.type === 'prefix');

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
  const row = document.createElement('div');
  row.className = 'live-item';
  const seedTag = item.seedKeyword ? ` <small style="color:#9CA3AF;">(${item.seedKeyword})</small>` : '';
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

  if (currentSeedList.length > 1) {
    elements.resultsKeywordLabel.textContent = `${currentSeedList.length} Seeds in Batch`;
  } else {
    elements.resultsKeywordLabel.textContent = `"${currentSeed}"`;
  }

  const dateStr = scan.endTime ? new Date(scan.endTime).toLocaleDateString() : 'Today';
  elements.resultsMeta.textContent = `${currentResults.length} keywords found · ${dateStr}`;

  elements.searchResults.value = '';
  selectedIndices = new Set(currentResults.map((_, i) => i));

  populateSeedDropdown();
  updateFilterTabs();
  renderResultsTable();
}

function populateSeedDropdown() {
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

  const suffixCount = filteredBySeed.filter(r => r.type === 'suffix').length;
  const prefixCount = filteredBySeed.filter(r => r.type === 'prefix').length;

  elements.tabAll.textContent = `All (${filteredBySeed.length})`;
  elements.tabSuffix.textContent = `After (${suffixCount})`;
  elements.tabPrefix.textContent = `Before (${prefixCount})`;

  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('tab--active', t.dataset.filter === currentFilter);
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
      const inSource = item.source.toLowerCase().includes(q);
      const inSeed = (item.seedKeyword || '').toLowerCase().includes(q);
      return inKeyword || inSource || inSeed;
    }
    return true;
  });
}

function renderResultsTable() {
  const filtered = getFilteredResults();
  elements.resultsBody.innerHTML = '';

  if (filtered.length === 0) {
    elements.resultsBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;padding:24px;color:#9CA3AF;">
          No matching keywords found.
        </td>
      </tr>
    `;
    elements.selectedCount.textContent = '0 selected';
    return;
  }

  const fragment = document.createDocumentFragment();

  filtered.forEach((item, index) => {
    const tr = document.createElement('tr');
    const originalIndex = currentResults.indexOf(item);
    const isChecked = selectedIndices.has(originalIndex);

    const len = (item.keyword || '').length;
    const isTagFit = len <= 20;
    const tagPillClass = isTagFit ? 'tag-pill--fit' : 'tag-pill--long';
    const tagTitle = isTagFit
      ? `${len} characters (Fits in Etsy 20-char tag limit)`
      : `${len} characters (Too long for tag, use in title)`;

    const seedLabel = item.seedKeyword || currentSeed;
    const etsySearchUrl = `https://www.etsy.com/search?q=${encodeURIComponent(item.keyword)}`;

    tr.innerHTML = `
      <td class="col-check">
        <input type="checkbox" data-index="${originalIndex}" ${isChecked ? 'checked' : ''}>
      </td>
      <td class="col-num">${index + 1}</td>
      <td class="col-keyword">
        ${escapeHTML(item.keyword)}
      </td>
      <td class="col-tag">
        <span class="tag-pill ${tagPillClass}" title="${tagTitle}">${len}c</span>
      </td>
      <td class="col-seed"><span class="seed-chip">${escapeHTML(seedLabel)}</span></td>
      <td class="col-ext">
        <a class="ext-link" href="${etsySearchUrl}" target="_blank" rel="noopener" title="Search on Etsy">↗</a>
      </td>
    `;

    fragment.appendChild(tr);
  });

  elements.resultsBody.appendChild(fragment);
  updateSelectedCountDisplay();
}

function updateSelectedCountDisplay() {
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
  const history = await getScanHistory();
  elements.historyList.innerHTML = '';

  if (!history || history.length === 0) {
    elements.historyEmpty.style.display = 'flex';
    elements.btnClearHistory.style.display = 'none';
    return;
  }

  elements.historyEmpty.style.display = 'none';
  elements.btnClearHistory.style.display = 'block';

  history.forEach(scan => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const count = scan.results?.length || 0;
    const dateStr = scan.startTime ? new Date(scan.startTime).toLocaleDateString() : '';
    const seedText = scan.seedList?.length > 1
      ? `${scan.seedList.length} Seeds: ${scan.keyword}`
      : scan.keyword;

    card.innerHTML = `
      <div style="flex:1;">
        <div class="history-card__keyword">${escapeHTML(seedText)}</div>
        <div class="history-card__meta">${dateStr} · ${scan.mode.toUpperCase()}</div>
      </div>
      <div class="history-card__count">${count}</div>
      <button class="history-card__del" data-id="${scan.id}" title="Delete scan">✕</button>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('history-card__del')) return;
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
  elements.seedKeyword.addEventListener('input', updateSeedBadge);

  // Quick Preset Chips (1-Click Idea buttons)
  document.querySelectorAll('.preset-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const kw = btn.dataset.keyword;
      elements.seedKeyword.value = kw;
      updateSeedBadge();
      showToast(`Selected "${kw}"`);
    });
  });

  // Start Scan
  elements.btnStart.addEventListener('click', handleStartScanClick);
  elements.seedKeyword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleStartScanClick();
    }
  });

  // Cancel Scan
  elements.btnCancel.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'CANCEL_SCAN' });
  });

  // Test Mode Toggle
  elements.testModeToggle.addEventListener('change', async (e) => {
    await saveSettings({ testMode: e.target.checked });
    await checkEtsyConnection();
  });

  // Search Results
  elements.searchResults.addEventListener('input', (e) => {
    currentSearch = e.target.value;
    renderResultsTable();
  });

  // Seed Filter Dropdown
  elements.filterSeed.addEventListener('change', (e) => {
    currentSeedFilter = e.target.value;
    updateFilterTabs();
    renderResultsTable();
  });

  // Filter Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentFilter = tab.dataset.filter;
      updateFilterTabs();
      renderResultsTable();
    });
  });

  // Select All Checkbox
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

  // Individual Table Checkboxes
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

  // CSV Export Button
  elements.btnCsv.addEventListener('click', () => {
    const exportItems = currentResults.filter((_, i) => selectedIndices.has(i));
    if (exportItems.length === 0) {
      showToast('⚠️ No keywords selected');
      return;
    }
    try {
      const filename = downloadCSV(exportItems, currentSeed);
      showToast(`⬇️ Downloaded ${filename}`);
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });

  // Copy 13 Etsy Tags Button (<=20 chars)
  elements.btnCopyTags.addEventListener('click', async () => {
    const candidateItems = currentResults.filter((_, i) => selectedIndices.has(i));
    const pool = candidateItems.length > 0 ? candidateItems : currentResults;
    const count = await copyEtsyTags(pool, 13);
    if (count === 0) {
      showToast('⚠️ No tags found under 20 chars');
    } else {
      showToast(`🏷️ Copied ${count} tags formatted for Etsy!`);
    }
  });

  // Copy All Keywords Button
  elements.btnCopy.addEventListener('click', async () => {
    const copyItems = currentResults.filter((_, i) => selectedIndices.has(i));
    if (copyItems.length === 0) {
      showToast('⚠️ No keywords selected');
      return;
    }
    const count = await copyToClipboard(copyItems);
    showToast(`✅ Copied ${count} keywords to clipboard!`);
  });

  // New Scan
  elements.btnResultsNew.addEventListener('click', () => {
    switchView('input');
  });

  // History Navigation
  elements.btnHistory.addEventListener('click', async () => {
    await loadHistoryView();
    switchView('history');
  });

  elements.btnHistoryBack.addEventListener('click', () => {
    switchView('input');
  });

  elements.btnStartFirst.addEventListener('click', () => {
    switchView('input');
  });

  elements.btnClearHistory.addEventListener('click', async () => {
    if (confirm('Clear all scan history?')) {
      await clearAllHistory();
      await loadHistoryView();
      showToast('History cleared');
    }
  });

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
        showToast(`🎉 Scan complete! Found ${message.scan.results.length} keywords.`);
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
  const testMode = elements.testModeToggle.checked;

  try {
    await chrome.runtime.sendMessage({
      type: 'START_SCAN',
      payload: { keywords: seedList, mode, testMode },
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

// Start
initializeApp();
