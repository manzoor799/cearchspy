/**
 * CearchSpy — Background Service Worker (Manifest V3)
 *
 * Ephemeral background worker that coordinates Alphabet Soup scans.
 * Supports multi-seed keyword batch queues.
 */

import { runScan, parseSeedKeywords } from '../lib/etsy-api.js';
import {
  getCurrentScan,
  setCurrentScan,
  saveScanToHistory,
  getSettings,
} from '../lib/storage.js';

let activeAbortController = null;

async function findEtsyTab() {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://*.etsy.com/*', 'https://etsy.com/*'] });
    if (tabs && tabs.length > 0) {
      const active = tabs.find(t => t.active);
      return active || tabs[0];
    }
  } catch {
    // Fallback
  }
  return null;
}

async function setBadge(text, color = '#F1641E') {
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

async function handleStartScan({ keywords, keyword, mode = 'both', testMode = false }) {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }

  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  const settings = await getSettings();
  const effectiveTestMode = testMode || settings.testMode;
  const etsyTab = await findEtsyTab();

  const seedList = parseSeedKeywords(keywords || keyword);
  if (seedList.length === 0) {
    broadcast({ type: 'SCAN_ERROR', error: 'No valid seed keywords provided' });
    return;
  }

  const scanId = `scan_${Date.now()}`;
  const totalQueries = seedList.length * (mode === 'both' ? 52 : 26);

  const scanState = {
    id: scanId,
    keyword: seedList.join(', '),
    seedList,
    currentSeed: seedList[0],
    seedIndex: 1,
    totalSeeds: seedList.length,
    mode,
    status: 'running',
    currentStep: 0,
    totalSteps: totalQueries,
    currentLetter: 'A',
    currentType: mode === 'prefix' ? 'prefix' : 'suffix',
    results: [],
    startTime: Date.now(),
  };

  await setCurrentScan(scanState);
  await setBadge('...', '#F1641E');
  broadcast({ type: 'SCAN_STARTED', scan: scanState });

  try {
    const results = await runScan({
      keywords: seedList,
      mode,
      delayMs: settings.delayMs,
      testMode: effectiveTestMode,
      etsyTabId: etsyTab?.id || null,
      signal,
      onProgress: async (progress) => {
        scanState.currentStep = progress.overallStep;
        scanState.totalSteps = progress.totalOverallSteps;
        scanState.currentSeed = progress.currentSeed;
        scanState.seedIndex = progress.seedIndex;
        scanState.totalSeeds = progress.totalSeeds;
        scanState.currentLetter = progress.letter;
        scanState.currentType = progress.type;
        scanState.results.push(...progress.newResults);

        await setCurrentScan(scanState);
        await setBadge(String(scanState.results.length), '#F1641E');

        broadcast({
          type: 'SCAN_PROGRESS',
          progress: {
            overallStep: progress.overallStep,
            totalOverallSteps: progress.totalOverallSteps,
            currentSeed: progress.currentSeed,
            seedIndex: progress.seedIndex,
            totalSeeds: progress.totalSeeds,
            currentStepForSeed: progress.currentStepForSeed,
            totalStepsForSeed: progress.totalStepsForSeed,
            letter: progress.letter,
            type: progress.type,
            query: progress.query,
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
    await setBadge(String(results.length), '#22C55E');

    if (etsyTab?.id) {
      chrome.tabs.sendMessage(etsyTab.id, { type: 'ETSY_SCAN_COMPLETE' }).catch(() => {});
    }

    broadcast({ type: 'SCAN_COMPLETED', scan: scanState });
  } catch (error) {
    if (etsyTab?.id) {
      chrome.tabs.sendMessage(etsyTab.id, { type: 'ETSY_SCAN_COMPLETE' }).catch(() => {});
    }

    if (error.name === 'AbortError') {
      scanState.status = 'cancelled';
      await setCurrentScan(scanState);
      await setBadge('');
      broadcast({ type: 'SCAN_CANCELLED' });
    } else {
      console.error('CearchSpy: Scan error', error);
      scanState.status = 'idle';
      await setCurrentScan(scanState);
      await setBadge('ERR', '#EF4444');
      broadcast({ type: 'SCAN_ERROR', error: error.message });
    }
  } finally {
    activeAbortController = null;
  }
}

async function handleCancelScan() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }

  const etsyTab = await findEtsyTab();
  if (etsyTab?.id) {
    chrome.tabs.sendMessage(etsyTab.id, { type: 'ETSY_SCAN_COMPLETE' }).catch(() => {});
  }

  const current = await getCurrentScan();
  if (current && current.status === 'running') {
    current.status = 'cancelled';
    await setCurrentScan(current);
  }

  await setBadge('');
  broadcast({ type: 'SCAN_CANCELLED' });
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

    case 'CHECK_ETSY_CONNECTION': {
      (async () => {
        const etsyTab = await findEtsyTab();
        sendResponse({
          connected: Boolean(etsyTab),
          tabId: etsyTab?.id || null,
          url: etsyTab?.url || null,
        });
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

    default:
      return false;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await setBadge('');
});
