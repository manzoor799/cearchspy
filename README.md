# 🔎 CearchSpy — Etsy Keyword Research Chrome Extension

**CearchSpy** is a lightweight, high-performance Chrome Extension (Manifest V3) that automates the **Alphabet Soup** keyword research technique directly on Etsy (`etsy.com`).

It uncovers real, high-converting buyer search terms in real time by systematically querying Etsy's autocomplete engine A–Z (both suffix and prefix), filtering out UI noise and raw query echoes, and exporting clean results to CSV.

---

## ✨ Features

- **Automated Alphabet Soup (A–Z)**:
  - **Suffix Search**: `keyword + a`, `keyword + b` ... `keyword + z`
  - **Prefix Search**: `a + keyword`, `b + keyword` ... `z + keyword`
  - **Both Mode**: Complete 52-query sweep.
- **Multi-Seed Batch Research**:
  - Enter multiple seed keywords at once (comma-separated or one per line).
  - Automatically processes seeds sequentially and groups results.
- **Real-Time Live Search Bar Typing**:
  - Visually types queries into Etsy's search bar with real DOM events and an active glowing outline.
- **Strict Quality & Relevance Filter**:
  - Strips out Etsy UI text like `"find shop names containing..."`.
  - Removes unrelated trending searches like `"Top searches this week"`.
  - Rejects unexpanded query echoes (e.g. `resume z` or `a resume`).
- **Etsy Listing Tag Helper (20-Character Limit)**:
  - Visual pill tags indicating whether keywords fit Etsy's 20-character tag limit (🟢 `≤20c`) or belong in the listing title (🟡 `>20c`).
  - **1-Click "🏷️ 13 Tags" Exporter**: Copies up to 13 tag-ready keywords directly to clipboard formatted for Etsy listings.
- **Export & Organization**:
  - Export to structured CSV with columns for `Keyword`, `Characters`, `Etsy Tag Ready`, `Seed Keyword`, `Source Query`, `Type`, `Letter`, and timestamp.
  - One-click copy all keywords to clipboard.
  - Clickable `↗` link on each keyword to inspect live competition directly on Etsy.
  - History view saving previous scans locally.
- **Zero Cost / 100% Client-Side**:
  - Runs directly in the browser via Manifest V3 content scripts and service workers without external servers or subscriptions.

---

## 🚀 Installation Guide

1. Clone or download this repository:
   ```bash
   git clone https://github.com/manzoor799/cearchspy.git
   ```
2. Open Google Chrome and navigate to:
   ```text
   chrome://extensions/
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the `cearchspy` project folder.
6. Pin **CearchSpy** to your Chrome toolbar by clicking the extensions puzzle piece icon (🧩) and clicking the pin icon next to CearchSpy.

---

## 🛠️ Project Structure

```text
cearchspy/
├── manifest.json              # Chrome Extension Manifest V3
├── background/
│   └── service-worker.js      # Background task orchestrator & storage sync
├── content/
│   └── etsy-scanner.js        # Content script driving Etsy search bar & DOM extraction
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.css              # Custom styling (Etsy brand palette)
│   └── popup.js               # UI controller, filtering & export handlers
├── lib/
│   ├── filter.js              # Strict relevance filter rules
│   ├── storage.js             # chrome.storage.local persistence wrapper
│   ├── csv-export.js          # RFC 4180 CSV export & clipboard tools
│   └── etsy-api.js            # A–Z query planner & multi-seed queue engine
└── icons/
    ├── icon-16.png            # 16x16 toolbar icon
    ├── icon-48.png            # 48x48 extensions manager icon
    └── icon-128.png           # 128x128 store & installation icon
```

---

## 📄 License

MIT License. Free to use and customize.
