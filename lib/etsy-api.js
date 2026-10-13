/**
 * CearchSpy — Etsy Autocomplete API & Multi-Seed Batch Orchestrator
 *
 * Coordinates keyword discovery across single or multiple seed keywords:
 * 1. Live Etsy Tab DOM Typing: Drives Etsy's search bar with real-time typing movement.
 * 2. Multi-Seed Batch Queue: Seamlessly runs Seed 1, then Seed 2, then Seed 3, etc.
 * 3. Strict Relevance Filtering: Ensures 100% genuine buyer search terms.
 * 4. Sandbox Test Mode: Offline instant verification mode.
 */

import { filterSuggestions } from './filter.js';

const ETSY_SUGGEST_URL = 'https://www.etsy.com/search/suggest';
const DEFAULT_DELAY_MS = 40;
const MAX_RETRIES = 2;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');

/**
 * Realistic dictionary for instant Sandbox/Bypass testing.
 */
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
};

/**
 * Parses user input into a clean list of unique seed keywords.
 * Supports line breaks and comma separation.
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

  // Return unique
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
 * Builds the complete A–Z query plan for a single seed keyword.
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
 * Causes live typing in Etsy's search bar!
 * @param {number} tabId
 * @param {string} query
 * @param {number} seedIndex
 * @param {number} totalSeeds
 * @returns {Promise<string[]|null>}
 */
async function fetchFromEtsyTab(tabId, query, seedIndex = 1, totalSeeds = 1) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'ETSY_SCAN_PROBE',
      query,
      seedIndex,
      totalSeeds,
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
 * Direct API fallback.
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
 * Runs a complete Alphabet Soup scan for one or more seed keywords.
 *
 * @param {Object} options
 * @param {string|string[]} options.keywords - One or multiple seed keywords.
 * @param {'both'|'suffix'|'prefix'} [options.mode] - Scan mode.
 * @param {number} [options.delayMs] - Delay between queries.
 * @param {boolean} [options.testMode] - Bypass network if true.
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
    etsyTabId = null,
    signal,
    onProgress,
  } = options;

  const seedList = parseSeedKeywords(keywords);
  if (seedList.length === 0) {
    throw new Error('No valid seed keywords provided');
  }

  const allResults = [];
  const seenKeywords = new Set();

  let overallStep = 0;
  const queriesPerSeed = (mode === 'both' ? 52 : 26);
  const totalOverallSteps = seedList.length * queriesPerSeed;

  for (let s = 0; s < seedList.length; s++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const currentSeed = seedList[s];
    const queries = buildQueryPlan(currentSeed, mode);

    for (let i = 0; i < queries.length; i++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      overallStep++;
      const { query, type, letter, letterLower } = queries[i];

      let rawSuggestions = [];

      if (testMode) {
        rawSuggestions = generateSandboxSuggestions(currentSeed, type, letterLower);
        await delay(10, signal);
      } else if (etsyTabId) {
        // Live search bar typing in Etsy tab!
        const tabResults = await fetchFromEtsyTab(etsyTabId, query, s + 1, seedList.length);
        if (tabResults && tabResults.length > 0) {
          rawSuggestions = tabResults;
        } else {
          rawSuggestions = await fetchDirectApi(query, signal);
        }
      } else {
        rawSuggestions = await fetchDirectApi(query, signal);
      }

      // Strict relevance filtering
      const cleanKeywords = filterSuggestions(rawSuggestions, currentSeed, query, seenKeywords);

      const stepNewResults = [];
      for (const kw of cleanKeywords) {
        const item = {
          keyword: kw,
          seedKeyword: currentSeed,
          source: query,
          type,
          letter,
          timestamp: Date.now(),
        };
        allResults.push(item);
        stepNewResults.push(item);
      }

      // Progress reporting with multi-seed metrics
      if (typeof onProgress === 'function') {
        onProgress({
          seedIndex: s + 1,
          totalSeeds: seedList.length,
          currentSeed,
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
        await delay(Math.min(delayMs, 50), signal);
      }
    }
  }

  return allResults;
}
