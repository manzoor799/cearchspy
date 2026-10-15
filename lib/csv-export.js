/**
 * E Keyword Spy — CSV Export & Data Formatting Module
 *
 * Formats keyword research data according to RFC 4180 CSV specifications,
 * includes UTF-8 BOM (\uFEFF) for seamless Excel compatibility,
 * and exports listing-ready Etsy tags.
 */

function escapeCSV(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Generates CSV string from an array of keyword items with Etsy tag readiness metrics.
 * Prefixed with UTF-8 BOM (\uFEFF) for native Excel compatibility.
 *
 * @param {Array<{ keyword: string, source: string, type: string, letter: string, seedKeyword?: string }>} items
 * @param {string} defaultSeed
 * @returns {string}
 */
export function generateCSV(items, defaultSeed = '') {
  const headers = [
    '#',
    'Keyword',
    'Characters',
    'Word Count',
    'Round',
    'Etsy Tag Ready (≤20)',
    'Seed Keyword',
    'Source Query',
    'Direction',
    'Letter',
    'Exported At',
  ];
  const timestamp = new Date().toISOString();

  const rows = items.map((item, index) => {
    const len = (item.keyword || '').length;
    const wordCount = item.wordCount || (item.keyword ? item.keyword.trim().split(/\s+/).filter(Boolean).length : 0);
    const roundLabel = item.round === 2 ? 'Round 2 (Long-Tail)' : 'Round 1';
    const directionLabel = item.type === 'suffix' ? 'After Word' : (item.type === 'prefix' ? 'Before Word' : 'Auto-Suggest');
    return [
      index + 1,
      item.keyword,
      len,
      wordCount,
      roundLabel,
      len <= 20 ? 'YES' : 'NO (Title Only)',
      item.seedKeyword || defaultSeed,
      item.source,
      directionLabel,
      item.letter,
      timestamp,
    ];
  });

  const allLines = [headers, ...rows].map(row => row.map(escapeCSV).join(','));
  return '\uFEFF' + allLines.join('\r\n');
}

function sanitizeFilename(str) {
  return str.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 30);
}

/**
 * Triggers a download of the keywords as a CSV file.
 *
 * @param {Array<{ keyword: string, source: string, type: string, letter: string, seedKeyword?: string }>} items
 * @param {string} seedKeyword
 * @returns {string} The filename that was downloaded.
 */
export function downloadCSV(items, seedKeyword = 'keywords') {
  if (!items || items.length === 0) {
    throw new Error('No keywords to export');
  }

  const csvContent = generateCSV(items, seedKeyword);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const dateStr = new Date().toISOString().split('T')[0];
  const safeSeed = sanitizeFilename(seedKeyword) || 'keywords';
  const filename = `ekeywordspy_${safeSeed}_${dateStr}.csv`;

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return filename;
}

/**
 * Copies a list of keywords to the system clipboard (one keyword per line).
 *
 * @param {Array<{ keyword: string }>} items
 * @returns {Promise<number>} Number of keywords copied.
 */
export async function copyToClipboard(items) {
  if (!items || items.length === 0) return 0;
  const text = items.map(i => i.keyword).join('\n');
  await navigator.clipboard.writeText(text);
  return items.length;
}

/**
 * Copies up to 13 keywords that fit Etsy's 20-character tag limit,
 * formatted as comma-separated tags ready to paste into Etsy's listing editor.
 *
 * @param {Array<{ keyword: string }>} items
 * @param {number} [maxCount]
 * @returns {Promise<number>} Number of tags copied.
 */
export async function copyEtsyTags(items, maxCount = 13) {
  const tagCandidates = items
    .filter(i => i.keyword && i.keyword.trim().length <= 20)
    .slice(0, maxCount)
    .map(i => i.keyword.trim());

  if (tagCandidates.length === 0) return 0;
  const tagString = tagCandidates.join(', ');
  await navigator.clipboard.writeText(tagString);
  return tagCandidates.length;
}
