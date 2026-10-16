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
const DEFAULT_DELAY_MS = 380;
const MAX_RETRIES = 2;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

/**
 * Custom error thrown when Etsy presents a verification challenge / CAPTCHA.
 */
export class CaptchaError extends Error {
  constructor(message = 'Etsy verification challenge detected', details = {}) {
    super(message);
    this.name = 'CaptchaError';
    this.details = details;
  }
}

/**
 * Calculates a natural human typing cadence with randomized jitter (+/- 20% to 25%).
 * Prevents automated pattern detection by Etsy's DataDome firewall.
 * @param {number} baseMs
 * @returns {number}
 */
export function getPacedDelay(baseMs = DEFAULT_DELAY_MS) {
  const ms = Math.max(80, Number(baseMs) || 380);
  const jitterRange = Math.round(ms * 0.22);
  const jitter = Math.floor(Math.random() * (jitterRange * 2 + 1)) - jitterRange;
  return Math.max(60, ms + jitter);
}

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
    'planner accessories',
    'planner adhd',
    'planner aesthetic',
    'planner app',
    'planner bundle',
    'planner book',
    'planner binder',
    'planner bundle digital',
    'planner bundle template',
    'planner canva',
    'planner cover',
    'planner calendar',
    'planner cards',
    'planner cleaning',
    'planner digital',
    'planner digital download',
  ],
  'planner accessories': [
    'planner accessories aesthetic',
    'planner accessories printable',
    'planner accessories stickers',
    'planner accessories acrylic',
    'planner accessories goodnotes',
  ],
  'planner adhd': [
    'planner adhd daily routine',
    'planner adhd digital goodnotes',
    'planner adhd adult printable',
    'planner adhd template canva',
  ],
  'planner aesthetic': [
    'planner aesthetic cute minimalist',
    'planner aesthetic printable 2026',
    'planner aesthetic binder inserts',
  ],
  'planner bundle': [
    'planner bundle digital printable',
    'planner bundle canva commercial use',
    'planner bundle template goodnotes',
  ],
  'planner digital': [
    'planner digital goodnotes 2026',
    'planner digital ipad hyperlinked',
    'planner digital budget spreadsheet',
    'planner digital daily weekly monthly',
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
  'planner accessories': {
    suffix: {
      a: ['planner accessories aesthetic', 'planner accessories acrylic', 'planner accessories aesthetic 2026'],
      b: ['planner accessories bundle', 'planner accessories binder pouch', 'planner accessories bookmarks'],
      c: ['planner accessories charms', 'planner accessories clips', 'planner accessories cute'],
      d: ['planner accessories divider', 'planner accessories digital goodnotes'],
      p: ['planner accessories printable', 'planner accessories pens', 'planner accessories pouch'],
      s: ['planner accessories stickers', 'planner accessories storage', 'planner accessories stationery'],
    },
  },
  'planner adhd': {
    suffix: {
      a: ['planner adhd adult', 'planner adhd adult printable', 'planner adhd app'],
      b: ['planner adhd binder', 'planner adhd bundle'],
      c: ['planner adhd canva', 'planner adhd cleaning routine'],
      d: ['planner adhd daily routine', 'planner adhd digital goodnotes', 'planner adhd daily checklist'],
      p: ['planner adhd printable template', 'planner adhd pdf download'],
    },
  },
  'planner digital': {
    suffix: {
      b: ['planner digital budget spreadsheet', 'planner digital bundle 2026'],
      d: ['planner digital daily weekly monthly', 'planner digital download ipad'],
      e: ['planner digital excel', 'planner digital ebook', 'planner digital editable', 'planner digital elements'],
      g: ['planner digital goodnotes 2026', 'planner digital google sheets'],
      h: ['planner digital hyperlinked tabs'],
      i: ['planner digital ipad goodnotes template'],
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
    if (response?.captchaDetected) {
      throw new CaptchaError('Etsy verification challenge detected in Etsy tab', response);
    }
    if (response && Array.isArray(response.suggestions)) {
      return response.suggestions;
    }
  } catch (err) {
    if (err instanceof CaptchaError || err.name === 'CaptchaError') {
      throw err;
    }
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
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
        },
        signal,
      });

      if (response.status === 429) {
        await delay(3000, signal);
        continue;
      }

      // If direct background fetch is blocked by DataDome or forbidden, return empty gracefully.
      // Do not throw a fake CaptchaError since there is no slider for the user to solve in a background fetch.
      if (response.status === 403 || !response.ok) {
        return [];
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return [];
      }

      const data = await response.json();
      return parseRawEtsyResponse(data);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (attempt < MAX_RETRIES - 1) {
        await delay(300, signal);
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

  const wordCount = seed.split(/\s+/).filter(Boolean).length;
  const modifiers = [
    'aesthetic', 'app', 'acrylic', 'adult', 'art',
    'bundle', 'binder', 'book', 'budget', 'best',
    'canva', 'calendar', 'cards', 'cleaning', 'custom', 'cute',
    'digital', 'download', 'design', 'daily', 'doc',
    'editable', 'elegant', 'executive', 'entry level', 'excel',
    'format', 'favors', 'floral', 'free download',
    'goodnotes', 'gift', 'guide', 'gradient',
    'hyperlinked', 'handmade', 'holder', 'header',
    'inserts', 'ipad', 'invitation', 'icons',
    'journal', 'job',
    'kit', 'keychain',
    'layout', 'listing', 'leather',
    'minimalist', 'modern', 'monthly', 'medical',
    'notebook', 'notion', 'nursing',
    'organizer', 'one page',
    'printable', 'pack', 'pdf', 'paper',
    'quick', 'quotes',
    'routine', 'refill', 'retro',
    'stickers', 'spreadsheet', 'simple', 'svg',
    'template', 'tracker', 'tags', 'typography',
    'unique', 'undated',
    'vintage', 'vector',
    'weekly', 'word', 'writing', 'widgets',
    'year', 'yearly',
  ];

  const matchingList = modifiers.filter(m => m.startsWith(letterLower));
  const primaryMatch = matchingList[0] || `${letterLower}style`;
  const secondaryMatch = matchingList[1] || `${letterLower}pack`;

  if (type === 'suffix') {
    if (wordCount >= 2) {
      // Generate 3-word, 4-word, and 5-word phrases!
      return [
        `${seed} ${primaryMatch}`,
        `${seed} ${primaryMatch} 2026`,
        `${seed} ${secondaryMatch} printable`,
      ];
    }
    return [
      `${seed} ${primaryMatch}`,
      `${seed} ${secondaryMatch}`,
      `${seed} ${primaryMatch} template`,
    ];
  } else {
    return [
      `${primaryMatch} ${seed}`,
      `best ${primaryMatch} ${seed}`,
    ];
  }
}

/**
 * Creates a normalized KeywordItem object.
 */
function createKeywordItem(keyword, seedKeyword, rootKeyword, source, type, letter, round = 1) {
  const words = keyword.trim().split(/\s+/).filter(Boolean);
  return {
    keyword,
    seedKeyword,
    rootKeyword: rootKeyword || seedKeyword,
    source,
    type,
    letter,
    round,
    wordCount: words.length,
    timestamp: Date.now(),
  };
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
    if (Array.isArray(tabResults)) {
      if (tabResults.length > 0) return tabResults;
      if (isRootProbe) {
        const clean = query.trim().toLowerCase();
        if (SANDBOX_ROOT_SUGGESTIONS[clean]) {
          return [...SANDBOX_ROOT_SUGGESTIONS[clean]];
        }
      }
      return tabResults;
    }
  }

  const direct = await fetchDirectApi(query, signal);
  if (Array.isArray(direct) && direct.length > 0) {
    return direct;
  }

  if (isRootProbe) {
    const clean = query.trim().toLowerCase();
    return SANDBOX_ROOT_SUGGESTIONS[clean] || [
      `${clean} template`,
      `${clean} bundle`,
      `${clean} digital`,
      `${clean} printable`,
    ];
  }

  return [];
}

/**
 * Runs a complete Alphabet Soup & Deep Auto-Suggest Tree scan.
 * Supports Round 1 (Seed + Branch) and Round 2 (Long-Tail Recursive Expansion).
 *
 * @param {Object} options
 * @param {string|string[]} options.keywords - One or multiple seed keywords.
 * @param {'both'|'suffix'|'prefix'} [options.mode] - Scan mode.
 * @param {number} [options.delayMs] - Delay between alphabet queries.
 * @param {boolean} [options.testMode] - Bypass network if true.
 * @param {boolean} [options.deepExpansion] - Enable recursive auto-suggest tree expansion.
 * @param {number|'all'} [options.branchLimit] - Maximum suggestion branches to expand per root.
 * @param {boolean} [options.isRound2] - True if this is a dedicated Round 2 long-tail expansion pass.
 * @param {boolean} [options.round2Expansion] - Enable automatic Round 2 long-tail expansion after Round 1.
 * @param {number|'all'} [options.round2Limit] - Max Round 1 keywords to expand into Round 2 long-tail.
 * @param {Array} [options.initialResults] - Existing results to preserve and accumulate without deletion.
 * @param {string} [options.rootSeed] - Primary root seed for attribution.
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
    isRound2 = false,
    round2Expansion = false,
    round2Limit = 5,
    initialResults = [],
    rootSeed = '',
    etsyTabId = null,
    signal,
    onProgress,
  } = options;

  const rawSeedList = parseSeedKeywords(keywords);
  if (rawSeedList.length === 0) {
    throw new Error('No valid seed keywords provided');
  }

  // Accumulate existing results without deletion!
  const allResults = Array.isArray(initialResults) ? [...initialResults] : [];
  const seenKeywords = new Set();
  allResults.forEach(item => {
    if (item?.keyword) seenKeywords.add(item.keyword.trim().toLowerCase());
  });

  const effectiveLimit = branchLimit === 'all' ? Infinity : (Number(branchLimit) || 3);
  const currentRoundNum = isRound2 ? 2 : 1;

  // Phase 1: Determine all branches to scan for current round
  const scanBranches = []; // Array of { rootSeed, branchName, isRoot: boolean }

  for (let s = 0; s < rawSeedList.length; s++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const primarySeed = rawSeedList[s];
    const effectiveRoot = rootSeed || primarySeed;

    // Always include the seed as a branch
    scanBranches.push({ rootSeed: effectiveRoot, branchName: primarySeed, isRoot: true });

    if (deepExpansion && !isRound2) {
      // 1. Notify UI that we are harvesting auto-suggestions for the root seed
      if (typeof onProgress === 'function') {
        onProgress({
          seedIndex: s + 1,
          totalSeeds: rawSeedList.length,
          currentSeed: primarySeed,
          branchName: primarySeed,
          rootSeed: effectiveRoot,
          branchIndex: 0,
          totalBranches: rawSeedList.length,
          overallStep: 0,
          totalOverallSteps: rawSeedList.length * (mode === 'both' ? 52 : 26),
          letter: 'AUTO',
          type: 'autocomplete',
          query: primarySeed,
          newResults: [],
          totalFound: allResults.length,
          round: currentRoundNum,
          currentRound: currentRoundNum,
          statusMessage: `Harvesting Auto-Suggestions for "${primarySeed}"...`,
        });
      }

      // 2. Physical probe on Etsy with trailing space and live pacing delay so the dropdown appears
      const rootQuery = `${primarySeed} `;
      const rawSuggestions = await probeKeyword(rootQuery, {
        etsyTabId,
        isRootProbe: true,
        pacingDelayMs: testMode ? 20 : 1500,
        testMode,
        signal,
        branchIndex: s + 1,
        totalBranches: rawSeedList.length,
      });

      // 3. Filter out noise & duplicates
      const cleanHarvested = filterSuggestions(rawSuggestions, primarySeed, '', seenKeywords);

      // 4. Save harvested root suggestions directly into results
      const harvestedItems = [];
      for (const itemKw of cleanHarvested) {
        const item = createKeywordItem(
          itemKw,
          primarySeed,
          effectiveRoot,
          `[Auto-Suggest] ${primarySeed}`,
          'autocomplete',
          'AUTO',
          currentRoundNum
        );
        allResults.push(item);
        harvestedItems.push(item);
      }

      // 5. Enqueue top harvested sub-niches as alphabet expansion branches if not doing Round 2
      if (!round2Expansion) {
        const topSubBranches = cleanHarvested.slice(0, effectiveLimit);
        for (const subBranch of topSubBranches) {
          if (subBranch.toLowerCase() !== primarySeed.toLowerCase()) {
            scanBranches.push({ rootSeed: effectiveRoot, branchName: subBranch, isRoot: false });
          }
        }
      }

      if (harvestedItems.length > 0 && typeof onProgress === 'function') {
        onProgress({
          seedIndex: s + 1,
          totalSeeds: rawSeedList.length,
          currentSeed: primarySeed,
          branchName: primarySeed,
          rootSeed: effectiveRoot,
          branchIndex: 0,
          totalBranches: scanBranches.length,
          overallStep: 0,
          totalOverallSteps: scanBranches.length * (mode === 'both' ? 52 : 26),
          letter: 'AUTO',
          type: 'autocomplete',
          query: primarySeed,
          newResults: harvestedItems,
          totalFound: allResults.length,
          round: currentRoundNum,
          currentRound: currentRoundNum,
        });
      }
    }
  }

  // Phase 2: Run Alphabet Soup across all queued branches
  const queriesPerBranch = (mode === 'both' ? 52 : 26);
  const totalOverallSteps = scanBranches.length * queriesPerBranch;
  let overallStep = 0;

  for (let b = 0; b < scanBranches.length; b++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { rootSeed: branchRoot, branchName, isRoot } = scanBranches[b];
    const queries = buildQueryPlan(branchName, mode);

    // Human-like physical search bar reset: Type root seed + space to simulate return movement before sub-branch
    if (etsyTabId && !isRoot) {
      await fetchFromEtsyTab(etsyTabId, `${branchRoot} `, b + 1, scanBranches.length, true, testMode ? 10 : 350);
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
        if (Array.isArray(tabResults)) {
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
        const item = createKeywordItem(
          kw,
          branchName,
          branchRoot,
          query,
          type,
          letter,
          currentRoundNum
        );
        allResults.push(item);
        stepNewResults.push(item);
      }

      if (typeof onProgress === 'function') {
        onProgress({
          branchIndex: b + 1,
          totalBranches: scanBranches.length,
          branchName,
          rootSeed: branchRoot,
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
          round: currentRoundNum,
          currentRound: currentRoundNum,
        });
      }

      if (overallStep < totalOverallSteps) {
        const stepDelay = testMode ? 10 : getPacedDelay(delayMs);
        await delay(stepDelay, signal);
      }
    }
  }

  // Phase 3: Automatic Round 2 Long-Tail Expansion (if enabled and not already running R2)
  if (!isRound2 && round2Expansion) {
    // 1. Collect multi-word keywords generated in Round 1
    const seenR2 = new Set(rawSeedList.map(s => s.toLowerCase().trim()));
    const r2Candidates = [];

    for (const item of allResults) {
      if (item.round === 1) {
        const kw = item.keyword.trim();
        const kwLower = kw.toLowerCase();
        const words = kw.split(/\s+/).filter(Boolean);
        // Expand phrases with 2 or 3 words into 4-word and 5-word long-tail keywords!
        if (words.length >= 2 && !seenR2.has(kwLower)) {
          seenR2.add(kwLower);
          r2Candidates.push(kw);
        }
      }
    }

    const effectiveR2Limit = round2Limit === 'all' ? 20 : (Number(round2Limit) || 5);
    const r2Branches = r2Candidates.slice(0, effectiveR2Limit);

    if (r2Branches.length > 0) {
      const r2StepsTotal = r2Branches.length * (mode === 'both' ? 52 : 26);
      let r2Step = 0;

      for (let r = 0; r < r2Branches.length; r++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const candidateSeed = r2Branches[r];
        const primaryRoot = rawSeedList[0] || candidateSeed;

        // Auto-Suggest probe for candidate phrase with trailing space
        const r2ProbeQuery = `${candidateSeed} `;
        if (typeof onProgress === 'function') {
          onProgress({
            round: 2,
            currentRound: 2,
            seedIndex: r + 1,
            totalSeeds: r2Branches.length,
            branchIndex: r + 1,
            totalBranches: r2Branches.length,
            branchName: candidateSeed,
            rootSeed: primaryRoot,
            currentSeed: candidateSeed,
            letter: 'AUTO',
            type: 'autocomplete',
            query: r2ProbeQuery,
            newResults: [],
            totalFound: allResults.length,
            statusMessage: `Round 2 Long-Tail: Harvesting "${candidateSeed}"...`,
          });
        }

        const rawR2Harvest = await probeKeyword(r2ProbeQuery, {
          etsyTabId,
          isRootProbe: true,
          pacingDelayMs: testMode ? 20 : 1200,
          testMode,
          signal,
          branchIndex: r + 1,
          totalBranches: r2Branches.length,
        });

        const cleanR2Harvest = filterSuggestions(rawR2Harvest, candidateSeed, '', seenKeywords);
        const r2HarvestItems = [];
        for (const kw of cleanR2Harvest) {
          const item = createKeywordItem(
            kw,
            candidateSeed,
            primaryRoot,
            `[R2 Auto] ${candidateSeed}`,
            'autocomplete',
            'AUTO',
            2 // Round 2
          );
          allResults.push(item);
          r2HarvestItems.push(item);
        }

        if (r2HarvestItems.length > 0 && typeof onProgress === 'function') {
          onProgress({
            round: 2,
            currentRound: 2,
            seedIndex: r + 1,
            totalSeeds: r2Branches.length,
            branchIndex: r + 1,
            totalBranches: r2Branches.length,
            branchName: candidateSeed,
            rootSeed: primaryRoot,
            currentSeed: candidateSeed,
            letter: 'AUTO',
            type: 'autocomplete',
            query: r2ProbeQuery,
            newResults: r2HarvestItems,
            totalFound: allResults.length,
          });
        }

        // Run Alphabet Soup on the candidate long-tail seed
        const r2Queries = buildQueryPlan(candidateSeed, mode);
        for (let q = 0; q < r2Queries.length; q++) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          r2Step++;
          const { query, type, letter, letterLower } = r2Queries[q];

          let r2Suggestions = [];
          if (testMode) {
            r2Suggestions = generateSandboxSuggestions(candidateSeed, type, letterLower);
            await delay(10, signal);
          } else if (etsyTabId) {
            const tabResults = await fetchFromEtsyTab(etsyTabId, query, r + 1, r2Branches.length, false, 0);
            if (Array.isArray(tabResults)) {
              r2Suggestions = tabResults;
            } else {
              r2Suggestions = await fetchDirectApi(query, signal);
            }
          } else {
            r2Suggestions = await fetchDirectApi(query, signal);
          }

          const cleanR2Keywords = filterSuggestions(r2Suggestions, candidateSeed, query, seenKeywords);
          const r2NewItems = [];
          for (const kw of cleanR2Keywords) {
            const item = createKeywordItem(
              kw,
              candidateSeed,
              primaryRoot,
              query,
              type,
              letter,
              2 // Round 2 Long-Tail
            );
            allResults.push(item);
            r2NewItems.push(item);
          }

          if (typeof onProgress === 'function') {
            onProgress({
              round: 2,
              currentRound: 2,
              branchIndex: r + 1,
              totalBranches: r2Branches.length,
              branchName: candidateSeed,
              rootSeed: primaryRoot,
              currentSeed: candidateSeed,
              seedIndex: r + 1,
              totalSeeds: r2Branches.length,
              currentStepForSeed: q + 1,
              totalStepsForSeed: r2Queries.length,
              overallStep: r2Step,
              totalOverallSteps: r2StepsTotal,
              letter,
              type,
              query,
              newResults: r2NewItems,
              totalFound: allResults.length,
              statusMessage: `Round 2 Long-Tail: "${query}"`,
            });
          }

          if (r2Step < r2StepsTotal) {
            const stepDelay = testMode ? 10 : getPacedDelay(delayMs);
            await delay(stepDelay, signal);
          }
        }
      }
    }
  }

  return allResults;
}
