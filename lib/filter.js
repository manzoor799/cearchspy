/**
 * CearchSpy — Strict Relevance & Quality Filter
 *
 * Designed specifically around Etsy search behavior:
 * 1. Blocks Etsy UI noise ("find shop names containing...", "Top searches this week", "gift mode", etc.)
 * 2. Blocks unrelated trending searches (e.g., "custom photo ornament", "wood jewelry box") that
 *    appear under the suggestions divider when typing on Etsy.
 * 3. Blocks raw query echoes (e.g. typing "resume z" or "a resume" when Etsy has no completions
 *    and merely repeats the probe query).
 * 4. Ensures the suggestion actually expands the seed keyword (e.g. "resume aesthetic",
 *    "resume ats", "resume canva", or prefix like "i edit resume", "best resume template").
 */

// Known Etsy UI action phrases and promotional section titles to discard immediately
const ETSY_UI_PHRASES = [
  'find shop names containing',
  'find shop names',
  'top searches this week',
  'popular right now',
  'recently viewed',
  'gift mode',
  'shop for',
  'search for items',
  'see more results for',
  'press enter to search',
];

/**
 * Normalizes a text string for comparison (lowercase, trimmed, collapse internal spaces).
 * @param {string} str
 * @returns {string}
 */
export function normalize(str) {
  if (typeof str !== 'string') return '';
  return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Checks whether a candidate suggestion is strictly relevant to the seed keyword.
 *
 * @param {string} rawSuggestion - The suggestion string from Etsy dropdown or API.
 * @param {string} seedKeyword - The user's seed niche / keyword (e.g. "resume").
 * @param {string} query - The exact probe query used (e.g. "resume a" or "i resume").
 * @returns {boolean} True if the suggestion is a genuine, relevant keyword expansion.
 */
export function isRelevantSuggestion(rawSuggestion, seedKeyword, query = '') {
  if (!rawSuggestion || typeof rawSuggestion !== 'string') {
    return false;
  }

  const suggestion = normalize(rawSuggestion);
  const seed = normalize(seedKeyword);
  const probe = normalize(query);

  // 1. Must not be empty
  if (suggestion.length === 0 || seed.length === 0) {
    return false;
  }

  // 2. Reject explicit Etsy UI actions and section titles
  for (const phrase of ETSY_UI_PHRASES) {
    if (suggestion.includes(phrase)) {
      return false;
    }
  }

  // 3. Must contain the seed keyword (or all seed words if multi-word)
  // For example, if seed is "resume", suggestion MUST contain "resume"
  // (e.g., "resume aesthetic", "i edit resume", "best resume template")
  // This automatically rejects "custom photo ornament", "wood jewelry box", etc.
  const seedWords = seed.split(' ').filter(w => w.length > 0);
  const containsAllSeedWords = seedWords.every(word => suggestion.includes(word));
  if (!containsAllSeedWords) {
    return false;
  }

  // 4. Reject exact match of the seed keyword itself (no new value added)
  if (suggestion === seed) {
    return false;
  }

  // 5. Reject exact echo of the probe query (e.g., query "resume z" -> dropdown "resume z",
  // or query "a resume" -> dropdown "a resume")
  // When Etsy has no completions for a letter, it echoes the exact typed query.
  if (probe.length > 0 && suggestion === probe) {
    return false;
  }

  // 6. Verify meaningful expansion:
  // When you subtract the seed keyword from the suggestion, the remaining text must be
  // a real expansion (at least 2 characters long), NOT just a solitary 1-character letter
  // like "z" or "a".
  // Example:
  // - "resume z" minus "resume" -> "z" (len 1 < 2) => REJECT (probe query echo)
  // - "a resume" minus "resume" -> "a" (len 1 < 2) => REJECT (probe query echo)
  // - "resume ai" minus "resume" -> "ai" (len 2 >= 2) => KEEP
  // - "resume cv" minus "resume" -> "cv" (len 2 >= 2) => KEEP
  // - "resume aesthetic" minus "resume" -> "aesthetic" (len 9 >= 2) => KEEP
  // - "i edit resume" minus "resume" -> "i edit" (len 6 >= 2) => KEEP
  const remainder = normalize(suggestion.replace(seed, ''));
  if (remainder.length < 2) {
    return false;
  }

  return true;
}

/**
 * Filters a raw list of suggestions, removing noise, duplicates, and irrelevant terms.
 *
 * @param {string[]} rawList - Array of raw suggestions from Etsy.
 * @param {string} seedKeyword - The user's seed keyword.
 * @param {string} query - The exact probe query (e.g. "resume a").
 * @param {Set<string>} [seenSet] - Optional existing Set of lowercase keywords to avoid duplicates.
 * @returns {string[]} Filtered, deduplicated array of clean keyword strings.
 */
export function filterSuggestions(rawList, seedKeyword, query = '', seenSet = new Set()) {
  if (!Array.isArray(rawList)) return [];

  const cleanList = [];

  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    const key = normalize(trimmed);

    if (seenSet.has(key)) continue;

    if (isRelevantSuggestion(trimmed, seedKeyword, query)) {
      seenSet.add(key);
      cleanList.push(trimmed);
    }
  }

  return cleanList;
}
