# E Keyword Spy — Etsy Keyword & Tag Research Chrome Extension

**E Keyword Spy** is a modern, high-performance Chrome Extension (Manifest V3) designed for Etsy sellers and e-commerce researchers to uncover high-intent, converting buyer search terms. Styled with a crisp, human-crafted SaaS aesthetic (Linear / Raycast / Stripe), it automates the proven **Alphabet Soup** keyword discovery technique directly on Etsy (`etsy.com`).

---

## Key Capabilities

- **Alphabet Soup Automation (A–Z)**:
  - **Suffix Search**: `keyword + a`, `keyword + b` … `keyword + z`
  - **Prefix Search**: `a + keyword`, `b + keyword` … `z + keyword`
  - **Both Directions**: Comprehensive 52-query sweep covering prefix and suffix queries.
- **Multi-Seed Batch Queue**:
  - Enter multiple seed keywords (comma-separated or line-by-line).
  - Processes each seed sequentially, tracks real-time progress, and aggregates results.
- **Real-Time Live Typing on Etsy**:
  - Types probe queries into Etsy's search bar with realistic input events and a subtle brand focus glow.
  - Displays a clean, non-intrusive live status overlay on the Etsy tab.
- **Strict Relevance & Noise Filter**:
  - Automatically strips Etsy navigational UI actions (`find shop names containing...`, `Top searches this week`, `gift mode`).
  - Discards unexpanded query echoes and irrelevant trending recommendations.
- **Etsy Listing Tag Counter (20-Character Limit)**:
  - Color-coded tag validation badges for each keyword:
    - `<= 17 characters`: Green badge (`tag-badge--fit`).
    - `18–20 characters`: Amber badge (`tag-badge--warn`).
    - `> 20 characters`: Red badge (`tag-badge--long`) indicating terms recommended for listing titles.
  - **1-Click 13 Tags Copy**: Instantly extracts up to 13 eligible tags within the 20-character limit, formatted with commas for Etsy's listing editor.
- **Data Export & Analysis**:
  - One-click CSV export with UTF-8 BOM encoding for seamless compatibility with Microsoft Excel, Google Sheets, and Numbers.
  - Instant clipboard copy for selected keywords.
  - Direct Etsy search links (`↗`) for real-time competitor and search volume verification.
  - Local scan history drawer with one-click reload and individual record deletion.
- **Instant Test Mode**:
  - Low-delay mode for rapid verification and smoke testing.
- **Zero Cost / 100% Client-Side**:
  - Operates completely in the browser with zero external servers, API keys, or subscriptions required.

---

## Installation Guide

1. Clone or download this repository:
   ```bash
   git clone https://github.com/manzoor799/cearchspy.git
   ```
2. Open Google Chrome and navigate to:
   ```text
   chrome://extensions/
   ```
3. Enable **Developer mode** using the toggle in the upper-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the project directory (`cearchspy`).
6. Pin **E Keyword Spy** to your browser toolbar for quick access.

---

## Architecture & File Structure

```text
cearchspy/
├── manifest.json              # Chrome Extension Manifest V3 configuration
├── background/
│   └── service-worker.js      # Background task orchestrator & storage sync
├── content/
│   └── etsy-scanner.js        # Content script driving Etsy search bar & DOM extraction
├── popup/
│   ├── popup.html             # 430px modern SaaS interface
│   ├── popup.css              # Design tokenized stylesheet (Brand: #4032C9)
│   └── popup.js               # Reactive UI controller & table manager
├── lib/
│   ├── filter.js              # Strict relevance & UI noise filtering engine
│   ├── storage.js             # chrome.storage.local persistence wrapper
│   ├── csv-export.js          # RFC 4180 CSV generation (UTF-8 BOM) & clipboard utils
│   └── etsy-api.js            # Multi-seed queue engine & A–Z query planner
└── icons/
    ├── icon-16.png            # 16x16 toolbar icon
    ├── icon-48.png            # 48x48 extensions management icon
    └── icon-128.png           # 128x128 store & installation icon
```

---

## Design System & Tokens

| Token | HEX / Value | Purpose |
| :--- | :--- | :--- |
| **Brand Primary** | `#4032C9` | Header, primary CTA button, active indicators |
| **Brand Hover** | `#2A1FB2` | Primary button hover state |
| **Brand Tint** | `#EEF2FF` | Active badges, table row hover, feature button tint |
| **Brand Border** | `#C7D2FE` | Accent borders and badge boundaries |
| **Success Green** | `#15803D` | Active connection dot, tags `<= 20c` |
| **Warning Amber** | `#D97706` | Tags approaching limit (`18–20c`) |
| **Danger Red** | `#DC2626` | Stop buttons, tags exceeding limit (`> 20c`) |
| **Canvas** | `#F8FAFC` | Main application background |
| **Card Surface** | `#FFFFFF` | Form cards, results table background |

---

## License

MIT License. Free to use, adapt, and distribute.
