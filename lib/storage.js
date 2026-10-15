/**
 * CearchSpy — Storage Management Module
 *
 * Persists extension state, scan progress, scan history, and user settings
 * using chrome.storage.local. Designed to survive Service Worker idle timeouts
 * and popup close/reopen cycles.
 */

const STORAGE_KEYS = {
  CURRENT_SCAN: 'cearchspy_current_scan',
  SCAN_HISTORY: 'cearchspy_scan_history',
  SETTINGS: 'cearchspy_settings',
};

const DEFAULT_SETTINGS = {
  scanMode: 'both',
  delayMs: 380,
  pacingMode: 'safe',
  testMode: false,
  useIncognito: false,
  deepExpansion: true,
  branchLimit: '3',
  round2Expansion: true,
  round2Limit: '5',
};

/**
 * Fallback memory store for testing outside Chrome extension runtime (e.g., node / unit test).
 */
const memoryStore = new Map();

/**
 * Safe chrome.storage.local getter that handles extension or fallback environments.
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getStorageItem(key) {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const result = await chrome.storage.local.get([key]);
    return result[key];
  }
  return memoryStore.get(key);
}

/**
 * Safe chrome.storage.local setter that handles extension or fallback environments.
 * @param {string} key
 * @param {any} value
 * @returns {Promise<void>}
 */
async function setStorageItem(key, value) {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  memoryStore.set(key, value);
}

/**
 * Safe chrome.storage.local remover.
 * @param {string} key
 * @returns {Promise<void>}
 */
async function removeStorageItem(key) {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.remove([key]);
    return;
  }
  memoryStore.delete(key);
}

// ==========================================
// CURRENT ACTIVE SCAN
// ==========================================

/**
 * @typedef {Object} KeywordItem
 * @property {string} keyword
 * @property {string} source
 * @property {'suffix'|'prefix'} type
 * @property {string} letter
 * @property {number} timestamp
 */

/**
 * @typedef {Object} ActiveScanState
 * @property {string} id
 * @property {string} keyword
 * @property {'both'|'suffix'|'prefix'} mode
 * @property {'idle'|'running'|'completed'|'cancelled'} status
 * @property {number} currentStep
 * @property {number} totalSteps
 * @property {string} currentLetter
 * @property {'suffix'|'prefix'} currentType
 * @property {KeywordItem[]} results
 * @property {number} startTime
 * @property {number} [endTime]
 */

/**
 * Gets the currently active (or most recently completed) scan state.
 * @returns {Promise<ActiveScanState|null>}
 */
export async function getCurrentScan() {
  const data = await getStorageItem(STORAGE_KEYS.CURRENT_SCAN);
  return data || null;
}

/**
 * Saves or updates the current scan state.
 * @param {ActiveScanState} scanState
 * @returns {Promise<void>}
 */
export async function setCurrentScan(scanState) {
  await setStorageItem(STORAGE_KEYS.CURRENT_SCAN, scanState);
}

/**
 * Clears the active scan state.
 * @returns {Promise<void>}
 */
export async function clearCurrentScan() {
  await removeStorageItem(STORAGE_KEYS.CURRENT_SCAN);
}

// ==========================================
// SCAN HISTORY
// ==========================================

/**
 * Retrieves the full list of saved scans from history (newest first).
 * @returns {Promise<ActiveScanState[]>}
 */
export async function getScanHistory() {
  const history = await getStorageItem(STORAGE_KEYS.SCAN_HISTORY);
  return Array.isArray(history) ? history : [];
}

/**
 * Adds or updates a completed scan in the history.
 * Caps history at 50 most recent scans to manage storage budget.
 * @param {ActiveScanState} scan
 * @returns {Promise<void>}
 */
export async function saveScanToHistory(scan) {
  if (!scan || !scan.id) return;
  const history = await getScanHistory();
  // Remove existing with same id if any
  const filtered = history.filter(item => item.id !== scan.id);
  // Add to top
  filtered.unshift(scan);
  // Cap at 50
  const trimmed = filtered.slice(0, 50);
  await setStorageItem(STORAGE_KEYS.SCAN_HISTORY, trimmed);
}

/**
 * Deletes a specific scan from history by ID.
 * @param {string} scanId
 * @returns {Promise<void>}
 */
export async function deleteScanFromHistory(scanId) {
  const history = await getScanHistory();
  const updated = history.filter(item => item.id !== scanId);
  await setStorageItem(STORAGE_KEYS.SCAN_HISTORY, updated);
}

/**
 * Clears all scan history.
 * @returns {Promise<void>}
 */
export async function clearAllHistory() {
  await setStorageItem(STORAGE_KEYS.SCAN_HISTORY, []);
}

// ==========================================
// USER SETTINGS
// ==========================================

/**
 * Retrieves user preferences.
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
export async function getSettings() {
  const settings = await getStorageItem(STORAGE_KEYS.SETTINGS);
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  return merged;
}

/**
 * Updates user preferences.
 * @param {Partial<typeof DEFAULT_SETTINGS>} updates
 * @returns {Promise<void>}
 */
export async function saveSettings(updates) {
  const current = await getSettings();
  await setStorageItem(STORAGE_KEYS.SETTINGS, { ...current, ...updates });
}
