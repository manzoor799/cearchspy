/**
 * E Keyword Spy — Etsy Autocomplete API & Recursive Tree Orchestrator
 *
 * Coordinates keyword discovery across single or multiple seed keywords:
 * 1. Deep Auto-Suggest Harvest: Captures top organic buyer suggestions for each seed
 *    (e.g., "resume template", "resume template word", "resume template bundle").
 * 2. Recursive Alphabet Expansion: Runs Alphabet Soup (A–Z) across each discovered branch.
 * 3. Live Etsy Tab DOM Typing: Drives Etsy's search bar with real-time typing movement.
 * 4. Strict Relevance Filtering: Ensures 100% genuine buyer search terms.
 * 5. Sandbox Test Mode: Offline instant verification mode.
 */

import { filterSuggestions } from './filter.js';

const ETSY_SUGGEST_URL = 'https://www.etsy.com/search/suggest';
const DEFAULT_DELAY_MS = 40;
const MAX_RETRIES = 2;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

/**
 * Realistic dictionary for instant Sandbox/Bypass testing.
 */
const SANDBOX_ROOT_SUGGESTIONS = {
  resume: [
    'resume template',
    'resume template word',
    'resume template bundle',
    'resume template digital',
    'resume template canva',
  ],
  'resume template': [
    'resume template canva',
    'resume template 2026',
    'resume template word',
    'resume template digital',
    'resume template aesthetic',
  ],
  wedding: [
    'wedding invitation',
    'wedding invitation template',
    'wedding welcome sign',
    'wedding favors',
  ],
  sticker: [
    'sticker pack',
    'stickers aesthetic',
    'sticker sheets',
    'sticker design',
  ],
  planner: [
    'planners digital',
    'planner templates',
    'planners',
    'planner template bundle',
    'planner stickers',
  ],
};

const SANDBOX_DATA = {
  resume: {
    suffix: {
      a: ['resume aesthetic', 'resume ats', 'resume ai', 'resume and cover', 'resume adhd'],
      b: ['resume builder', 'resume bundle', 'resume bundle template', 'resume builder template', 'resume builder kit'],
      c: ['resume canva', 'resume cv', 'resume cover letter', 'resume cover', 'resume creative'],
      d: ['resume design', 'resume digital', 'resume download', 'resume doc'],
      e: ['resume editable', 'resume elegant', 'resume executive', 'resume entry level'],
      f: ['resume for nurse', 'resume format', 'resume free download', 'resume for college student'],
      g: ['resume google docs', 'resume graphic design', 'resume grad'],
      h: ['resume help', 'resume holder', 'resume header'],
      i: ['resume icons', 'resume interview', 'resume infographic'],
      j: ['resume job', 'resume journal'],
      k: ['resume kit', 'resume key'],
      l: ['resume layout', 'resume linkedin', 'resume letter'],
      m: ['resume modern', 'resume minimalist', 'resume medical', 'resume mac pages'],
      n: ['resume nursing', 'resume new grad', 'resume navy'],
      o: ['resume organizer', 'resume one page'],
      p: ['resume professional', 'resume pack', 'resume pdf', 'resume psychology'],
      q: ['resume quick', 'resume questions'],
      r: ['resume review', 'resume reference sheet', 'resume real estate'],
      s: ['resume simple', 'resume svg', 'resume student', 'resume service'],
      t: ['resume template', 'resume teacher', 'resume tech', 'resume typography'],
      u: ['resume upgrade', 'resume unique'],
      v: ['resume vector', 'resume vintage'],
      w: ['resume word', 'resume writing', 'resume with photo'],
      x: [],
      y: ['resume yellow'],
      z: [],
    },
    prefix: {
      a: ['a resume template', 'academic resume'],
      b: ['best resume template', 'basic resume', 'black resume template'],
      c: ['creative resume', 'clean resume template', 'canva resume template'],
      d: ['digital resume', 'doctor resume template'],
      e: ['executive resume', 'elegant resume template', 'entry level resume'],
      f: ['federal resume template', 'formal resume'],
      g: ['google docs resume', 'graphic design resume template'],
      h: ['healthcare resume template', 'hr resume'],
      i: ['i edit resume', 'it resume template', 'infographic resume template'],
      j: ['job resume template'],
      k: ['kickstart resume'],
      l: ['lawyer resume template'],
      m: ['modern resume template', 'minimalist resume', 'medical resume template'],
      n: ['nurse resume template', 'nursing student resume'],
      o: ['one page resume template'],
      p: ['professional resume template', 'psychology resume'],
      q: ['quality resume'],
      r: ['retro resume template'],
      s: ['simple resume template', 'student resume template'],
      t: ['tech resume template', 'teacher resume template'],
      u: ['unique resume template'],
      v: ['veterinary resume template'],
      w: ['word resume template', 'writer resume'],
      x: [],
      y: ['youth resume'],
      z: [],
    },
  },
  'resume template': {
    suffix: {
      a: ['resume template aesthetic', 'resume template ats', 'resume template apple', 'resume template ai', 'resume template apple pages'],
      b: ['resume template bundle', 'resume template builder'],
      c: ['resume template canva', 'resume template cv', 'resume template creative'],
      d: ['resume template doc', 'resume template digital'],
      w: ['resume template word'],
    },
  },
  'resume template word': {
    suffix: {
      b: ['resume template word bundle', 'resume template word business'],
    },
  },
  'resume template bundle': {
    suffix: {
      c: ['resume template bundle canva', 'resume template bundle college'],
    },
  },
  'planner digital': {
    suffix: {
      e: ['planner digital excel', 'planner digital ebook', 'planner digital editable', 'planner digital elements'],
    },
  },
};

/**
 * Parses user input into a clean list of unique seed keywords.
 * @param {string|string[]} rawInput
 * @returns {string[]}
 */
export function parseSeedKeywords(rawInput) {
  if (Array.isArray(rawInput)) {
    return rawInput.map(k => String(k).trim()).filter(Boolean);
  }
  if (typeof rawInput !== 'string') return [];

  const splitItems = rawInput
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return [...new Set(splitItems)];
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });
}

/**
 * Builds the complete A–Z query plan for a single seed or sub-branch.
 * @param {string} keyword
 * @param {'both'|'suffix'|'prefix'} mode
 * @returns {{ query: string, type: 'suffix'|'prefix', letter: string, letterLower: string }[]}
 */
export function buildQueryPlan(keyword, mode = 'both') {
  const queries = [];
  const cleanKeyword = keyword.trim().toLowerCase();

  if (mode === 'suffix' || mode === 'both') {
    for (const letter of ALPHABET) {
      queries.push({
        query: `${cleanKeyword} ${letter}`,
        type: 'suffix',
        letter: letter.toUpperCase(),
        letterLower: letter,
      });
    }
  }

  if (mode === 'prefix' || mode === 'both') {
    for (const letter of ALPHABET) {
      queries.push({
        query: `${letter} ${cleanKeyword}`,
        type: 'prefix',
        letter: letter.toUpperCase(),
        letterLower: letter,
      });
    }
  }

  return queries;
}

/**
 * Sends a probe query to the active Etsy tab content script.
 * @param {number} tabId
 * @param {string} query
 * @param {number} branchIndex
 * @param {number} totalBranches
 * @param {boolean} isRootProbe
 * @param {number} pacingDelayMs
 * @returns {Promise<string[]|null>}
 */
async function fetchFromEtsyTab(tabId, query, branchIndex = 1, totalBranches = 1, isRootProbe = false, pacingDelayMs = 1500) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'ETSY_SCAN_PROBE',
      query,
      branchIndex,
      totalBranches,
      isRootProbe,
      pacingDelayMs,
    });
    if (response && Array.isArray(response.suggestions)) {
      return response.suggestions;
    }
  } catch {
    // Content script unavailable
  }
  return null;
}

/**
 * Direct API fallback query.
 * @param {string} query
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
async function fetchDirectApi(query, signal) {
  const url = `${ETSY_SUGGEST_URL}?q=${encodeURIComponent(query)}&lang=en-US`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });

      if (response.status === 429) {
        await delay(3000, signal);
        continue;
      }

      if (!response.ok) return [];

      const data = await response.json();
      return parseRawEtsyResponse(data);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (attempt < MAX_RETRIES - 1) {
        await delay(400, signal);
      }
    }
  }
  return [];
}

function parseRawEtsyResponse(data) {
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

  return [];
}

function generateSandboxSuggestions(seedKeyword, type, letterLower) {
  const seed = seedKeyword.trim().toLowerCase();
  const known = SANDBOX_DATA[seed]?.[type]?.[letterLower];
  if (known) return [...known];

  const modifiers = [
    'template', 'design', 'digital', 'printable', 'kit', 'bundle', 'svg',
    'minimalist', 'modern', 'custom', 'handmade', 'gift', 'decor', 'art',
  ];
  const matching = modifiers.find(m => m.startsWith(letterLower));

  if (type === 'suffix') {
    if (matching) return [`${seed} ${matching}`, `${seed} ${matching} pack`];
    return [`${seed} ${letterLower}style`];
  } else {
    if (matching) return [`${matching} ${seed}`, `best ${matching} ${seed}`];
    return [`custom ${letterLower} ${seed}`];
  }
}

/**
 * Probes a query using either the active Etsy tab or the direct endpoint.
 */
async function probeKeyword(query, { etsyTabId, isRootProbe = false, pacingDelayMs = 1500, testMode = false, signal, branchIndex = 1, totalBranches = 1 }) {
  if (testMode) {
    await delay(isRootProbe ? 20 : 10, signal);
    if (isRootProbe) {
      const clean = query.trim().toLowerCase();
      if (SANDBOX_ROOT_SUGGESTIONS[clean]) {
        return [...SANDBOX_ROOT_SUGGESTIONS[clean]];
      }
      return [
        `${clean} template`,
        `${clean} bundle`,
        `${clean} digital`,
        `${clean} printable`,
      ];
    }
    return [];
  }

  if (etsyTabId) {
    const tabResults = await fetchFromEtsyTab(etsyTabId, query, branchIndex, totalBranches, isRootProbe, pacingDelayMs);
    if (tabResults && tabResults.length > 0) {
      return tabResults;
    }
  }

  return await fetchDirectApi(query, signal);
}

/**
 * Runs a complete Alphabet Soup & Deep Auto-Suggest Tree scan.
 *
 * @param {Object} options
 * @param {string|string[]} options.keywords - One or multiple seed keywords.
 * @param {'both'|'suffix'|'prefix'} [options.mode] - Scan mode.
 * @param {number} [options.delayMs] - Delay between alphabet queries.
 * @param {boolean} [options.testMode] - Bypass network if true.
 * @param {boolean} [options.deepExpansion] - Enable recursive auto-suggest tree expansion.
 * @param {number|'all'} [options.branchLimit] - Maximum suggestion branches to expand per root.
 * @param {number} [options.etsyTabId] - Etsy tab ID for live DOM typing.
 * @param {AbortSignal} [options.signal] - Abort controller signal.
 * @param {Function} [options.onProgress] - Progress callback.
 * @returns {Promise<import('./storage.js').KeywordItem[]>}
 */
export async function runScan(options) {
  const {
    keywords,
    mode = 'both',
    delayMs = DEFAULT_DELAY_MS,
    testMode = false,
    deepExpansion = true,
    branchLimit = 3,
    etsyTabId = null,
    signal,
    onProgress,
  } = options;

  const rawSeedList = parseSeedKeywords(keywords);
  if (rawSeedList.length === 0) {
    throw new Error('No valid seed keywords provided');
  }

  const allResults = [];
  const seenKeywords = new Set();
  const effectiveLimit = branchLimit === 'all' ? Infinity : (Number(branchLimit) || 3);

  // Phase 1: Determine all branches to scan
  const scanBranches = []; // Array of { rootSeed, branchName, isRoot: boolean }

  for (let s = 0; s < rawSeedList.length; s++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const rootSeed = rawSeedList[s];

    // Always include the root seed as the primary branch
    scanBranches.push({ rootSeed, branchName: rootSeed, isRoot: true });

    if (deepExpansion) {
      // 1. Notify UI that we are harvesting auto-suggestions for the root seed
      if (typeof onProgress === 'function') {
        onProgress({
          seedIndex: s + 1,
          totalSeeds: rawSeedList.length,
          currentSeed: rootSeed,
          branchName: rootSeed,
          rootSeed,
          branchIndex: 0,
          totalBranches: rawSeedList.length,
          overallStep: 0,
          totalOverallSteps: rawSeedList.length * (mode === 'both' ? 52 : 26),
          letter: 'AUTO',
          type: 'autocomplete',
          query: rootSeed,
          newResults: [],
          totalFound: allResults.length,
          statusMessage: `Harvesting Auto-Suggestions for "${rootSeed}"...`,
        });
      }

      // 2. Physical probe on Etsy with trailing space and live pacing delay so the dropdown appears
      const rootQuery = `${rootSeed} `;
      const rawSuggestions = await probeKeyword(rootQuery, {
        etsyTabId,
        isRootProbe: true,
        pacingDelayMs: testMode ? 20 : 1500,
        testMode,
        signal,
        branchIndex: s + 1,
        totalBranches: rawSeedList.length,
      });

      // 3. Filter out noise & duplicates (adds to seenKeywords)
      const cleanHarvested = filterSuggestions(rawSuggestions, rootSeed, '', seenKeywords);

      // 4. Save harvested root suggestions directly into results
      const harvestedItems = [];
      for (const itemKw of cleanHarvested) {
        const item = {
          keyword: itemKw,
          seedKeyword: rootSeed,
          rootKeyword: rootSeed,
          source: `[Auto-Suggest] ${rootSeed}`,
          type: 'autocomplete',
          letter: 'AUTO',
          timestamp: Date.now(),
        };
        allResults.push(item);
        harvestedItems.push(item);
      }

      // 5. Enqueue top harvested sub-niches as alphabet expansion branches
      const topSubBranches = cleanHarvested.slice(0, effectiveLimit);
      for (const subBranch of topSubBranches) {
        if (subBranch.toLowerCase() !== rootSeed.toLowerCase()) {
          scanBranches.push({ rootSeed, branchName: subBranch, isRoot: false });
        }
      }

      if (harvestedItems.length > 0 && typeof onProgress === 'function') {
        onProgress({
          seedIndex: s + 1,
          totalSeeds: rawSeedList.length,
          currentSeed: rootSeed,
          branchName: rootSeed,
          rootSeed,
          branchIndex: 0,
          totalBranches: scanBranches.length,
          overallStep: 0,
          totalOverallSteps: scanBranches.length * (mode === 'both' ? 52 : 26),
          letter: 'AUTO',
          type: 'autocomplete',
          query: rootSeed,
          newResults: harvestedItems,
          totalFound: allResults.length,
        });
      }
    }
  }

  // Phase 2: Run Alphabet Soup across all queued branches!
  const queriesPerBranch = (mode === 'both' ? 52 : 26);
  const totalOverallSteps = scanBranches.length * queriesPerBranch;
  let overallStep = 0;

  for (let b = 0; b < scanBranches.length; b++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { rootSeed, branchName, isRoot } = scanBranches[b];
    const queries = buildQueryPlan(branchName, mode);

    // Human-like physical search bar reset: Type root seed + space to simulate return movement before sub-branch
    if (etsyTabId && !isRoot) {
      await fetchFromEtsyTab(etsyTabId, `${rootSeed} `, b + 1, scanBranches.length, true, testMode ? 10 : 350);
    }

    for (let i = 0; i < queries.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      overallStep++;
      const { query, type, letter, letterLower } = queries[i];

      let rawSuggestions = [];

      if (testMode) {
        rawSuggestions = generateSandboxSuggestions(branchName, type, letterLower);
        await delay(10, signal);
      } else if (etsyTabId) {
        const tabResults = await fetchFromEtsyTab(etsyTabId, query, b + 1, scanBranches.length, false, 0);
        if (tabResults && tabResults.length > 0) {
          rawSuggestions = tabResults;
        } else {
          rawSuggestions = await fetchDirectApi(query, signal);
        }
      } else {
        rawSuggestions = await fetchDirectApi(query, signal);
      }

      const cleanKeywords = filterSuggestions(rawSuggestions, branchName, query, seenKeywords);

      const stepNewResults = [];
      for (const kw of cleanKeywords) {
        const item = {
          keyword: kw,
          seedKeyword: branchName,
          rootKeyword: rootSeed,
          source: query,
          type,
          letter,
          timestamp: Date.now(),
        };
        allResults.push(item);
        stepNewResults.push(item);
      }

      if (typeof onProgress === 'function') {
        onProgress({
          branchIndex: b + 1,
          totalBranches: scanBranches.length,
          branchName,
          rootSeed,
          currentSeed: branchName,
          seedIndex: b + 1,
          totalSeeds: scanBranches.length,
          currentStepForSeed: i + 1,
          totalStepsForSeed: queries.length,
          overallStep,
          totalOverallSteps,
          letter,
          type,
          query,
          newResults: stepNewResults,
          totalFound: allResults.length,
        });
      }

      if (overallStep < totalOverallSteps) {
        await delay(Math.min(delayMs, 40), signal);
      }
    }
  }

  return allResults;
}
