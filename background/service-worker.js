/**
 * CearchSpy — Background Service Worker (Manifest V3)
 *
 * Ephemeral background worker that coordinates Alphabet Soup scans.
 * Supports multi-seed keyword batch queues.
 */

import { runScan, parseSeedKeywords, CaptchaError } from '../lib/etsy-api.js';
import {
  getCurrentScan,
  setCurrentScan,
  saveScanToHistory,
  getSettings,
} from '../lib/storage.js';

let activeAbortController = null;
let pausedScanParams = null;
let isScanRunning = false;
let isRecovering = false;

/**
 * Discovers all open Etsy tabs across windows, spaces, and AI browser sidebars.
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
async function getAllEtsyTabs() {
  try {
    const allTabs = await chrome.tabs.query({});
    if (Array.isArray(allTabs) && allTabs.length > 0) {
      const etsyTabs = allTabs.filter(t => {
        const u = (t.url || t.pendingUrl || '').toLowerCase();
        return u.includes('etsy.com');
      });
      if (etsyTabs.length > 0) return etsyTabs;
    }
  } catch {}

  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.etsy.com/*', '*://etsy.com/*'] });
    if (Array.isArray(tabs) && tabs.length > 0) return tabs;
  } catch {}

  return [];
}

const SCRIPT_VERSION = '1.3.0';

/**
 * Ensures the content script is actively injected, initialized, and listening.
 * Automatically verifies version so that existing open tabs get upgraded dynamically.
 * @param {number} tabId
 * @param {boolean} [force]
 * @returns {Promise<boolean>}
 */
async function ensureContentScriptInjected(tabId, force = false) {
  if (!tabId) return false;
  if (!force) {
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { type: 'ETSY_PING' });
      if (ping && ping.success && ping.version === SCRIPT_VERSION) return true;
    } catch {}
  }

  // Inject content script dynamically into tab
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/etsy-scanner.js'],
    });
    await new Promise(r => setTimeout(r, 200));
    const verify = await chrome.tabs.sendMessage(tabId, { type: 'ETSY_PING' });
    return Boolean(verify && verify.success);
  } catch (err) {
    console.warn('E Keyword Spy: ensureContentScriptInjected warning', err);
    return false;
  }
}

async function findOrCreateEtsyTab(useIncognito = false) {
  try {
    const tabs = await getAllEtsyTabs();

    if (useIncognito) {
      const incognitoTab = tabs.find(t => t.incognito && t.active) || tabs.find(t => t.incognito);
      if (incognitoTab) {
        try {
          await chrome.tabs.update(incognitoTab.id, { active: true });
          if (incognitoTab.windowId) {
            await chrome.windows.update(incognitoTab.windowId, { focused: true });
          }
        } catch {}
        await ensureContentScriptInjected(incognitoTab.id);
        return incognitoTab;
      }

      // No Incognito Etsy tab open: Check permission and attempt opening Incognito Etsy window
      let isAllowed = false;
      try {
        isAllowed = await chrome.extension.isAllowedIncognitoAccess();
      } catch {
        isAllowed = false;
      }

      if (isAllowed) {
        const win = await chrome.windows.create({
          url: 'https://www.etsy.com',
          incognito: true,
          focused: true,
        });
        const targetTab = win.tabs?.[0];
        if (targetTab) {
          await new Promise(r => setTimeout(r, 2600));
          await ensureContentScriptInjected(targetTab.id);
          return targetTab;
        }
      }

      // Fallback: If Incognito is unavailable, gracefully fall back to active regular tab
      const fallbackRegular = tabs.find(t => t.active) || tabs[0];
      if (fallbackRegular) {
        await ensureContentScriptInjected(fallbackRegular.id);
        return fallbackRegular;
      }
    } else {
      // Standard Tab: Prioritize active Etsy tab in CURRENT window, or active in any window, or any open Etsy tab
      const currentWinTabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
      const currentActive = currentWinTabs?.[0];
      const isCurrentActiveEtsy = (currentActive?.url || '').toLowerCase().includes('etsy.com');

      const regularTab = (isCurrentActiveEtsy ? currentActive : null)
        || tabs.find(t => !t.incognito && t.active)
        || tabs.find(t => !t.incognito)
        || tabs.find(t => t.active)
        || tabs[0];

      if (regularTab) {
        try {
          await chrome.tabs.update(regularTab.id, { active: true });
          if (regularTab.windowId) {
            await chrome.windows.update(regularTab.windowId, { focused: true });
          }
        } catch {}
        await ensureContentScriptInjected(regularTab.id);
        return regularTab;
      }

      // No Etsy tab open at all: Automatically open Etsy in current window!
      const newTab = await chrome.tabs.create({
        url: 'https://www.etsy.com',
        active: true,
      });
      await new Promise(r => setTimeout(r, 2400));
      await ensureContentScriptInjected(newTab.id);
      return newTab;
    }
  } catch (err) {
    console.warn('E Keyword Spy: findOrCreateEtsyTab warning', err);
  }
  return null;
}

async function findEtsyTab() {
  return await findOrCreateEtsyTab(false);
}

async function setBadge(text, color = '#4032C9') {
  try {
    await chrome.action.setBadgeText({ text: text || '' });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ color });
    }
  } catch {
    // Action unavailable
  }
}

function broadcast(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // Popup closed
  }
}

async function handleStartScan({
  keywords,
  keyword,
  mode = 'both',
  testMode = false,
  deepExpansion = true,
  branchLimit = 3,
  useIncognito = false,
  isRound2 = false,
  round2Expansion = false,
  round2Limit = 5,
  initialResults = [],
  rootSeed = '',
  resumeFromStep = 0,
}) {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }

  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;
  isScanRunning = true;

  const settings = await getSettings();
  const effectiveTestMode = testMode || settings.testMode;
  const effectiveRound2Expansion = round2Expansion !== undefined ? round2Expansion : (settings.round2Expansion !== false);
  const effectiveRound2Limit = round2Limit || settings.round2Limit || 5;
  const etsyTab = await findOrCreateEtsyTab(useIncognito && !effectiveTestMode);

  const seedList = parseSeedKeywords(keywords || keyword);
  if (seedList.length === 0) {
    isScanRunning = false;
    broadcast({ type: 'SCAN_ERROR', error: 'No valid seed keywords provided' });
    return;
  }

  // Schedule a persistent watchdog alarm to survive service worker suspension during sleep/lock
  try {
    chrome.alarms.create('scan_watchdog', { periodInMinutes: 0.5 });
  } catch {}

  const scanId = isRound2 ? `scan_r2_${Date.now()}` : `scan_${Date.now()}`;
  const branchMultiplier = deepExpansion ? (branchLimit === 'all' ? 4 : (Number(branchLimit) + 1)) : 1;
  const totalQueries = seedList.length * (mode === 'both' ? 52 : 26) * branchMultiplier;

  const scanParams = {
    keywords: seedList,
    mode,
    testMode: effectiveTestMode,
    deepExpansion,
    branchLimit,
    isRound2,
    round2Expansion: effectiveRound2Expansion,
    round2Limit: effectiveRound2Limit,
    rootSeed: rootSeed || seedList[0],
    useIncognito,
    delayMs: settings.delayMs,
  };

  const scanState = {
    id: scanId,
    keyword: seedList.join(', '),
    seedList,
    currentSeed: seedList[0],
    seedIndex: 1,
    totalSeeds: seedList.length,
    branchName: seedList[0],
    branchIndex: 1,
    totalBranches: seedList.length,
    mode,
    deepExpansion,
    branchLimit,
    isRound2,
    round2Expansion: effectiveRound2Expansion,
    round2Limit: effectiveRound2Limit,
    rootSeed: rootSeed || seedList[0],
    currentRound: isRound2 ? 2 : 1,
    status: 'running',
    currentStep: resumeFromStep || 0,
    totalSteps: totalQueries,
    currentLetter: deepExpansion ? 'AUTO' : 'A',
    currentType: mode === 'prefix' ? 'prefix' : 'suffix',
    results: Array.isArray(initialResults) ? [...initialResults] : [],
    startTime: Date.now(),
    lastHeartbeat: Date.now(),
    scanParams,
  };

  await setCurrentScan(scanState);
  await setBadge('...', '#4032C9');
  broadcast({ type: 'SCAN_STARTED', scan: scanState });

  try {
    const results = await runScan({
      keywords: seedList,
      mode,
      delayMs: settings.delayMs,
      testMode: effectiveTestMode,
      deepExpansion,
      branchLimit,
      isRound2,
      round2Expansion: effectiveRound2Expansion,
      round2Limit: effectiveRound2Limit,
      initialResults: scanState.results,
      rootSeed: scanState.rootSeed,
      etsyTabId: etsyTab?.id || null,
      signal,
      resumeFromStep,
      onProgress: async (progress) => {
        if (!isScanRunning || signal.aborted || scanState.status === 'cancelled') {
          return;
        }
        scanState.currentStep = progress.overallStep;
        scanState.totalSteps = progress.totalOverallSteps;
        scanState.currentSeed = progress.currentSeed;
        scanState.seedIndex = progress.seedIndex;
        scanState.totalSeeds = progress.totalSeeds;
        scanState.branchName = progress.branchName || progress.currentSeed;
        scanState.branchIndex = progress.branchIndex || progress.seedIndex;
        scanState.totalBranches = progress.totalBranches || progress.totalSeeds;
        scanState.rootSeed = progress.rootSeed || progress.currentSeed;
        scanState.currentLetter = progress.letter;
        scanState.currentType = progress.type;
        scanState.statusMessage = progress.statusMessage || '';
        scanState.currentRound = progress.currentRound || progress.round || (isRound2 ? 2 : 1);
        scanState.lastHeartbeat = Date.now();

        if (progress.newResults && progress.newResults.length > 0) {
          scanState.results.push(...progress.newResults);
        }

        await setCurrentScan(scanState);
        await setBadge(String(scanState.results.length), '#4032C9');

        broadcast({
          type: 'SCAN_PROGRESS',
          progress: {
            overallStep: progress.overallStep,
            totalOverallSteps: progress.totalOverallSteps,
            currentSeed: progress.currentSeed,
            seedIndex: progress.seedIndex,
            totalSeeds: progress.totalSeeds,
            branchName: progress.branchName || progress.currentSeed,
            branchIndex: progress.branchIndex || progress.seedIndex,
            totalBranches: progress.totalBranches || progress.totalSeeds,
            rootSeed: progress.rootSeed || progress.currentSeed,
            statusMessage: progress.statusMessage || '',
            currentStepForSeed: progress.currentStepForSeed,
            totalStepsForSeed: progress.totalStepsForSeed,
            letter: progress.letter,
            type: progress.type,
            query: progress.query,
            round: progress.round || scanState.currentRound,
            currentRound: scanState.currentRound,
            newResults: progress.newResults,
            totalFound: scanState.results.length,
          },
        });
      },
    });

    scanState.status = 'completed';
    scanState.endTime = Date.now();
    scanState.results = results;

    await setCurrentScan(scanState);
    await saveScanToHistory(scanState);
    await setBadge(String(results.length), '#15803D');

    try {
      await chrome.alarms.clear('scan_watchdog');
    } catch {}

    if (etsyTab?.id) {
      chrome.tabs.sendMessage(etsyTab.id, { type: 'ETSY_SCAN_COMPLETE' }).catch(() => {});
    }

    pausedScanParams = null;
    broadcast({ type: 'SCAN_COMPLETED', scan: scanState });
  } catch (error) {
    if (error.name === 'CaptchaError' || error instanceof CaptchaError || error.message?.includes('verification challenge')) {
      console.warn('E Keyword Spy: Scan paused due to Etsy verification challenge:', error);
      scanState.status = 'paused_captcha';
      scanState.captchaMessage = error.message;
      scanState.captchaTime = Date.now();
      scanState.lastHeartbeat = Date.now();
      scanState.tabId = etsyTab?.id || null;

      // Retain paused scan parameters for 1-click seamless resume
      pausedScanParams = {
        payload: {
          ...scanParams,
          initialResults: scanState.results, // Retain ALL keywords found so far!
          resumeFromStep: scanState.currentStep,
        },
        tabId: etsyTab?.id || null,
      };

      await setCurrentScan(scanState);
      await setBadge('VERIF', '#D97706');

      // Bring Etsy tab to front so user immediately sees the slider
      if (etsyTab?.id) {
        try {
          await chrome.tabs.update(etsyTab.id, { active: true });
          if (etsyTab.windowId) {
            await chrome.windows.update(etsyTab.windowId, { focused: true });
          }
        } catch {}
      }

      broadcast({
        type: 'SCAN_PAUSED_CAPTCHA',
        scan: scanState,
        tabId: etsyTab?.id || null,
        message: 'Etsy security verification slider detected. Please slide the slider on Etsy, then click Resume.',
      });
      return;
    }

    try {
      await chrome.alarms.clear('scan_watchdog');
    } catch {}

    if (etsyTab?.id) {
      chrome.tabs.sendMessage(etsyTab.id, { type: 'ETSY_SCAN_COMPLETE' }).catch(() => {});
    }

    pausedScanParams = null;

    if (error.name === 'AbortError') {
      scanState.status = 'cancelled';
      await setCurrentScan(scanState);
      await setBadge('');
      broadcast({ type: 'SCAN_CANCELLED' });
    } else {
      console.error('E Keyword Spy: Scan error', error);
      scanState.status = 'idle';
      await setCurrentScan(scanState);
      await setBadge('ERR', '#DC2626');
      broadcast({ type: 'SCAN_ERROR', error: error.message });
    }
  } finally {
    isScanRunning = false;
    activeAbortController = null;
  }
}

async function handleCancelScan() {
  isScanRunning = false;
  isRecovering = false;
  if (activeAbortController) {
    try { activeAbortController.abort(); } catch {}
    activeAbortController = null;
  }
  try {
    await chrome.alarms.clear('scan_watchdog');
  } catch {}

  pausedScanParams = null;

  // Immediately persist cancelled status so nothing can overwrite it
  const current = await getCurrentScan();
  if (current) {
    current.status = 'cancelled';
    current.lastHeartbeat = Date.now();
    await setCurrentScan(current);
  }

  const etsyTab = await findEtsyTab();
  if (etsyTab?.id) {
    chrome.tabs.sendMessage(etsyTab.id, { type: 'ETSY_SCAN_COMPLETE' }).catch(() => {});
  }

  await setBadge('');
  broadcast({ type: 'SCAN_CANCELLED' });
}

async function handleResumeScan(overrideTestMode = false, resumeFromStep = 0, forceResume = false) {
  const current = await getCurrentScan();
  if (!current || (current.status !== 'paused_captcha' && current.status !== 'running')) {
    return { success: false, message: 'No paused or active scan to resume' };
  }

  const effectiveStep = resumeFromStep || current.currentStep || 0;
  const tabId = pausedScanParams?.tabId || current.tabId;
  const savedParams = current.scanParams || pausedScanParams?.payload || {};

  // If overrideTestMode is requested, resume with testMode immediately
  if (overrideTestMode) {
    const payload = {
      keywords: current.seedList || [current.keyword],
      mode: savedParams.mode || current.mode || 'both',
      testMode: true,
      deepExpansion: savedParams.deepExpansion !== undefined ? savedParams.deepExpansion : (current.deepExpansion !== false),
      branchLimit: savedParams.branchLimit || current.branchLimit || 3,
      isRound2: Boolean(savedParams.isRound2 || current.isRound2),
      round2Expansion: savedParams.round2Expansion !== undefined ? savedParams.round2Expansion : (current.round2Expansion !== false),
      round2Limit: savedParams.round2Limit || current.round2Limit || 5,
      initialResults: current.results || [],
      rootSeed: savedParams.rootSeed || current.rootSeed || current.keyword,
      useIncognito: false,
      resumeFromStep: effectiveStep,
    };
    current.status = 'running';
    current.lastHeartbeat = Date.now();
    await setCurrentScan(current);
    handleStartScan(payload);
    return { success: true, testMode: true };
  }

  // Check if Etsy tab has resolved the slider (only if was paused_captcha AND not a forced user resume)
  if (forceResume) {
    await setBadge('...', '#4032C9');
    if (tabId) {
      try {
        await ensureContentScriptInjected(tabId, true);
      } catch {}
    }
  } else if (current.status === 'paused_captcha' && tabId) {
    try {
      const verif = await chrome.tabs.sendMessage(tabId, { type: 'CHECK_VERIFICATION_RESOLVED' });
      // Only block if definitely still challenged AND no valid search input is accessible
      if (verif && !verif.resolved && !verif.hasSearchInput) {
        // Bring Etsy tab to front again
        try {
          await chrome.tabs.update(tabId, { active: true });
        } catch {}
        return { success: false, stillChallenged: true, message: 'Verification slider is still present on Etsy. Please slide to secure access.' };
      }
    } catch {
      // Content script response unavailable
    }
  }

  const payload = {
    keywords: current.seedList || [current.keyword],
    mode: savedParams.mode || current.mode || 'both',
    testMode: savedParams.testMode || current.testMode || false,
    deepExpansion: savedParams.deepExpansion !== undefined ? savedParams.deepExpansion : (current.deepExpansion !== false),
    branchLimit: savedParams.branchLimit || current.branchLimit || 3,
    isRound2: Boolean(savedParams.isRound2 || current.isRound2),
    round2Expansion: savedParams.round2Expansion !== undefined ? savedParams.round2Expansion : (current.round2Expansion !== false),
    round2Limit: savedParams.round2Limit || current.round2Limit || 5,
    initialResults: current.results || [],
    rootSeed: savedParams.rootSeed || current.rootSeed || current.keyword,
    useIncognito: savedParams.useIncognito !== undefined ? savedParams.useIncognito : (current.useIncognito || false),
    resumeFromStep: effectiveStep,
  };

  current.status = 'running';
  current.lastHeartbeat = Date.now();
  await setCurrentScan(current);
  handleStartScan(payload);
  return { success: true };
}

/**
 * Watchdog recovery function: Inspects active scan state. If service worker died, was
 * suspended during sleep/lock, or in-flight loop hung >12 seconds, automatically revives
 * the scan from the exact current step without losing any collected keywords.
 * @param {boolean} [forceRevive]
 */
async function checkAndRecoverStalledScan(forceRevive = false) {
  if (isRecovering) return;
  // Never automatically revive unless explicitly requested or currently active
  if (!isScanRunning && !forceRevive) return;

  try {
    const current = await getCurrentScan();
    if (!current || current.status !== 'running') return;

    const now = Date.now();
    const lastBeat = current.lastHeartbeat || current.startTime || 0;
    const idleMs = now - lastBeat;

    // Abandon stale scans older than 30 seconds to prevent ghost runs
    if (idleMs > 30000) {
      current.status = 'cancelled';
      await setCurrentScan(current);
      try { await chrome.alarms.clear('scan_watchdog'); } catch {}
      await setBadge('');
      return;
    }

    // If an in-memory scan is actively executing and has beaten within 12 seconds, it is healthy!
    if (isScanRunning && activeAbortController && !forceRevive) {
      if (idleMs < 12000) return;
    }

    console.log(`[E Keyword Spy Watchdog] Recovering stalled scan at step ${current.currentStep}/${current.totalSteps} (idle ${Math.round(idleMs / 1000)}s)...`);
    isRecovering = true;

    if (activeAbortController) {
      try { activeAbortController.abort(); } catch {}
      activeAbortController = null;
    }

    await handleResumeScan(false, current.currentStep || 0);
  } catch (err) {
    console.warn('[E Keyword Spy Watchdog] Error recovering scan:', err);
  } finally {
    isRecovering = false;
  }
}

// Runtime Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  switch (message.type) {
    case 'START_SCAN': {
      (async () => {
        await handleStartScan(message.payload);
        sendResponse({ success: true });
      })();
      return true;
    }

    case 'CANCEL_SCAN': {
      (async () => {
        await handleCancelScan();
        sendResponse({ success: true });
      })();
      return true;
    }

    case 'RESUME_SCAN': {
      (async () => {
        const result = await handleResumeScan(
          Boolean(message.overrideTestMode),
          message.resumeFromStep || 0,
          Boolean(message.forceResume)
        );
        sendResponse(result);
      })();
      return true;
    }

    case 'CHECK_CAPTCHA_RESOLVED': {
      (async () => {
        const current = await getCurrentScan();
        const tabId = pausedScanParams?.tabId || current?.tabId;
        if (!tabId) {
          sendResponse({ resolved: true });
          return;
        }
        try {
          const verif = await chrome.tabs.sendMessage(tabId, { type: 'CHECK_VERIFICATION_RESOLVED' });
          sendResponse(verif || { resolved: true });
        } catch {
          sendResponse({ resolved: true });
        }
      })();
      return true;
    }

    case 'FOCUS_ETSY_TAB': {
      (async () => {
        const current = await getCurrentScan();
        const tabId = message.tabId || pausedScanParams?.tabId || current?.tabId;
        if (tabId) {
          try {
            const tab = await chrome.tabs.get(tabId);
            await chrome.tabs.update(tabId, { active: true });
            if (tab.windowId) {
              await chrome.windows.update(tab.windowId, { focused: true });
            }
            sendResponse({ success: true });
            return;
          } catch {}
        }
        sendResponse({ success: false });
      })();
      return true;
    }

    case 'CHECK_ETSY_CONNECTION': {
      (async () => {
        let isIncognitoAllowed = false;
        try {
          isIncognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
        } catch {
          isIncognitoAllowed = false;
        }

        const tabs = await getAllEtsyTabs();
        const currentWinTabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
        const currentActive = currentWinTabs?.[0];
        const isCurrentActiveEtsy = (currentActive?.url || '').toLowerCase().includes('etsy.com');

        const activeTab = (isCurrentActiveEtsy ? currentActive : null)
          || tabs.find(t => t.active)
          || tabs.find(t => !t.incognito)
          || tabs[0]
          || null;

        if (activeTab?.id) {
          await ensureContentScriptInjected(activeTab.id);
        }

        sendResponse({
          connected: Boolean(activeTab),
          tabId: activeTab?.id || null,
          url: activeTab?.url || null,
          isIncognito: Boolean(activeTab?.incognito),
          isIncognitoAllowed,
          hasIncognitoTab: Boolean(incognitoTab),
        });
      })();
      return true;
    }

    case 'OPEN_INCOGNITO_ETSY': {
      (async () => {
        try {
          const isAllowed = await chrome.extension.isAllowedIncognitoAccess();
          if (!isAllowed) {
            sendResponse({ success: false, reason: 'NOT_ALLOWED' });
            return;
          }
          const win = await chrome.windows.create({
            url: 'https://www.etsy.com',
            incognito: true,
            focused: true,
          });
          sendResponse({ success: true, windowId: win.id });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'GET_CURRENT_STATUS': {
      (async () => {
        const current = await getCurrentScan();
        sendResponse({ currentScan: current });
      })();
      return true;
    }

    case 'PING_OR_RESUME_SCAN': {
      (async () => {
        await checkAndRecoverStalledScan();
        sendResponse({ success: true, isRunning: isScanRunning });
      })();
      return true;
    }

    case 'KICKSTART_SCAN': {
      (async () => {
        await checkAndRecoverStalledScan(true);
        sendResponse({ success: true, isRunning: isScanRunning });
      })();
      return true;
    }

    default:
      return false;
  }
});

// Watchdog Alarm Listener (fires periodically to survive Mac App Nap & Service Worker idle timeouts)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'scan_watchdog') {
    checkAndRecoverStalledScan();
  }
});

// Profile / Browser Startup Listener: Do NOT automatically start scans!
chrome.runtime.onStartup.addListener(async () => {
  try {
    await chrome.alarms.clear('scan_watchdog');
    const current = await getCurrentScan();
    if (current && current.status === 'running') {
      current.status = 'cancelled';
      await setCurrentScan(current);
    }
  } catch {}
  await setBadge('');
});

chrome.runtime.onInstalled.addListener(async () => {
  await setBadge('');
});
