# LocatorHub — Architecture

## 1. Bird's-eye view

```
Chrome Browser
│
├── Inspected Page (any website)
│   └── DOM — where $0, querySelectorAll, getEventListeners live
│
└── DevTools
    ├── Elements panel  ←  user clicks elements here ($0 changes)
    │
    └── LocatorHub sidebar pane  ←  our extension
        ├── devtools.html / devtools.js   (registers the pane)
        └── panel.html / panel.js        (the entire UI + logic)
```

---

## 2. File responsibilities

```
LocatorHub/
│
├── manifest.json       Tells Chrome: "this is an extension, entry = devtools.html"
│
├── devtools.html       Loaded silently by Chrome when DevTools opens.
│   devtools.js    ──► calls createSidebarPane("LocatorHub") → panel.html
│                       also wires sidebar.onShown → win.locatorHubRefresh()
│
├── panel.html          The visible UI — all CSS lives here (inline <style>)
│   panel.js       ──► all logic: engine definition, DOM refs, render functions
│
├── create-icons.js     One-time Node script — writes icons/*.png using
│                       raw PNG byte construction (CRC32 + zlib, no npm)
│
└── icons/              Static PNG files loaded by Chrome for the extension card
```

---

## 3. The two JS contexts

This is the most important concept in the extension. There are **two completely separate JavaScript environments** that cannot share memory or variables directly.

```
┌──────────────────────────────┐     ┌──────────────────────────────────────┐
│   DevTools Extension Page    │     │        Inspected Page                │
│   (panel.js runs here)       │     │  (any website — gmail, github, etc.) │
│                              │     │                                      │
│  chrome.devtools.*  ✅        │     │  document.querySelectorAll()  ✅     │
│  navigator.clipboard ✅       │     │  document.evaluate() (XPath)  ✅     │
│  DOM of panel.html  ✅        │     │  window.getComputedStyle()    ✅     │
│                              │     │  getEventListeners($0)        ✅     │
│  $0                 ❌        │     │  $0 (selected element)        ✅     │
│  querySelectorAll   ❌        │     │                                      │
│  page's DOM         ❌        │     │  chrome.devtools.*            ❌     │
│                              │     │  panel.html DOM               ❌     │
└──────────┬───────────────────┘     └──────────────────────────────────────┘
           │                                          ▲
           │  inspectedWindow.eval(LOCATOR_ENGINE)    │
           └──────────────────────────────────────────┘
                     JSON string crosses the bridge
```

The only bridge between these two worlds is `chrome.devtools.inspectedWindow.eval()` — it sends a **string of code** to execute in the inspected page and receives back a **JSON-serialised result**.

---

## 4. The eval trick — why `__locatorEngine` is a real function

The locator engine needs to run inside the inspected page (to access `$0`, `querySelectorAll`, etc.), but it is written in `panel.js`. The solution: define it as a real JavaScript function and convert it to a string via `.toString()`.

```js
// ✅ Correct — defined as a real function, regex literals survive .toString()
function __locatorEngine() {
  if (/\d{4,}/.test(cls)) { ... }   // \d is preserved exactly as written
}
var LOCATOR_ENGINE = '(' + __locatorEngine.toString() + ')()';

// ❌ Wrong — template literals silently mangle backslashes
var LOCATOR_ENGINE = `if (/\d{4,}/.test(cls)) ...`;
//                          ^^^ \d becomes just d — broken regex
```

`__locatorEngine` is **never called in `panel.js`**. It exists only so V8's `.toString()` can extract its source code verbatim. The resulting string becomes a self-invoking function (IIFE) that runs inside the inspected page.

`$0` is accessed safely inside the function as:
```js
var el = (typeof $0 !== 'undefined') ? $0 : null;
```
`typeof` never throws on an undeclared identifier, so this is safe even in the panel context where `$0` doesn't exist.

---

## 5. Trigger → render data flow

```
User clicks element in the Elements panel
        │
        ▼  chrome.devtools.panels.elements.onSelectionChanged
        │  (also fires on: ↻ Refresh button, sidebar tab switch via onShown)
        │
analyzeElement()  [panel.js — DevTools context]
        │
        │  chrome.devtools.inspectedWindow.eval(LOCATOR_ENGINE)
        │  ─── string of JS code sent to inspected page ──────────►
        │
__locatorEngine()  [runs inside inspected page]
        │
        ├─ Reads $0  (the currently selected element)
        │
        ├─ Generates locator candidates
        │    ├─ Element itself   → ID, test attrs, aria-label, name, classes, text
        │    ├─ Walk UP ≤10 ancestors  → CSS + XPath anchored at each stable ancestor
        │    ├─ Walk DOWN ≤10 descendants → contains-descendant XPath
        │    └─ Preceding siblings  → label/following-sibling XPath
        │
        ├─ Validates each candidate
        │    ├─ CSS   → document.querySelectorAll(selector).length
        │    └─ XPath → document.evaluate(...).snapshotLength
        │
        ├─ Scores + ranks: sort by score, keep top 15, assign rank 1–15
        │
        ├─ Collects getEventListeners($0)
        └─ Collects getComputedStyle(el) for ~30 key properties
        │
        │  ◄─── JSON.stringify({elementInfo, locators, events, styles}) ───
        │
renderResults(data)  [panel.js — DevTools context]
        ├─ renderElemBar()         updates sticky header (tag, id, classes)
        ├─ renderRankedList()      #results-meta + ranked rows 1–15
        ├─ renderEventListeners()  collapsible per event type
        └─ renderStyles()          Inline + Computed sub-sections
```

---

## 6. Locator strategy catalogue

All candidates are scored; only the top 15 are returned, assigned rank 1–15.

| Priority | Strategy | Method | How it's built |
|----------|----------|--------|----------------|
| 1 | ID | CSS | `#id` using `CSS.escape()` |
| 2 | ID (XPath) | XPath | `//*[@id='...']` |
| 3–6 | data-testid / data-cy / data-qa / data-test | CSS | `[attr="value"]` |
| 7 | aria-label | CSS | `[aria-label="..."]` |
| 8 | name | CSS | `[name="..."]` |
| 9 | XPath (attrs) | XPath | Up to 3 stable attrs: `//tag[@type='' and @name='']` |
| 10 | XPath (text) | XPath | Direct text nodes: `//tag[normalize-space(text())='...']` |
| 11 | full text XPath | XPath | All inner text: `//tag[normalize-space(.)='...']` |
| 12 | class combo | CSS | Stable classes only (auto-generated ones filtered out) |
| 13 | ancestor CSS | CSS | One entry per stable ancestor found, up to 10 deep |
| 14 | ancestor XPath | XPath | Same walk, path down: `//*[@id='x']/div/button` |
| 15 | contains attr | XPath | `//tag[.//child[@id='...']]` — descendant scan |
| 16 | sibling XPath | XPath | `//label[text()='...']/following-sibling::tag[1]` |
| 17 | nth-of-type | CSS | Full structural path — always flagged fragile |

---

## 7. Scoring formula

```
score = match_penalty + strategy_priority + fragility_penalty

match_penalty
  1 match   →      0    (unique — ideal)
  N matches →  N × 100  (ambiguous)
  0 / error →   9000    (invalid — pushed to bottom)

strategy_priority (lower = more reliable)
  ID = 1  …  nth-of-type = 20

fragility_penalty
  fragile  → +50
  stable   →   0
```

Lower total score → better rank. Rank 1 is the most reliable locator for automation.

---

## 8. Fragility detection

A locator is flagged **⚡ Fragile** when it matches any of these patterns:

| Pattern | Why it's fragile |
|---------|-----------------|
| XPath starts with `/html` | Absolute path — any DOM restructure breaks it |
| XPath contains `[N]` (digit index) | Positional — breaks if elements are inserted/removed |
| CSS uses `:nth-child` or `:nth-of-type` | Same positional problem |

Fragile locators **still appear** in the list (they may be the only option on some pages) but score 50 points worse and rank lower. The ⚡ icon is a warning to the engineer, not a disqualifier.

---

## 9. Auto-generated class detection

The class-combo strategy (`tag.cls1.cls2`) skips classes that look auto-generated, since they change on every build. A class is excluded if it matches any of:

| Pattern | Example |
|---------|---------|
| 6+ consecutive hex chars | `abc123f`, `d4e5f6a` |
| 4+ consecutive digits | `item1234`, `row9876` |
| 2–4 char prefix + `-` + 5+ alphanums with a digit | `sc-bhXjX`, `css-x7f9k2` |
| Underscore-prefix hash | `_3x1a2b`, `_hash` |

---

## 10. UI layout

```
┌─────────────────────────────────────────┐
│  🎯 LocatorHub   <h2> #id .cls   [↻]  │  ← #header  (position: sticky)
├─────────────────────────────────────────┤
│  #content  (overflow-y: auto)           │
│                                         │
│  12 locators — 4 unique match           │  ← #results-meta
│                                         │
│  ①  ID           #submit-btn   1 match │  ← 🟢 rank-top (ranks 1–5)
│  ②  data-testid  [data-test…]  1 match │
│  ③  aria-label   [aria-label…] 1 match │
│  ④  ancestor CSS #form input   1 match │
│  ⑤  XPath(attrs) //input[@ty…] 1 match │
│                                         │
│  ⑥  XPath(text)  //button[no… 2 match │  ← 🟡 rank-mid (ranks 6–10)
│  ⑦  ancestor XP  //*[@id='fo… 1 match │
│  …                                      │
│                                         │
│  ⑫  nth-of-type  div>section…  1 match ⚡│  ← 🔴 rank-low (ranks 11–15)
│                                         │
│  ─── ⚡ Event Listeners ─────────────  │  ← section-hdr (sticky top: 0)
│    click ×2                             │
│      ↳ handleSubmit   [capture]         │
│      ↳ (anonymous)                      │
│                                         │
│  ─── 🎨 Styles ───────────────────────  │  ← section-hdr (sticky top: 0)
│    Inline:    color: red                │
│    Computed:  display: flex             │
│               visibility: visible       │
│               …                         │
└─────────────────────────────────────────┘
```

`body` is a `flex-direction: column` container. `#header` is `flex-shrink: 0`. `#content` is `flex: 1; overflow-y: auto; min-height: 0`. Section headers inside `#content` use `position: sticky; top: 0` — they stick within the content scroll area, not the viewport.

---

## 11. Sidebar registration and auto-refresh

```js
// devtools.js
chrome.devtools.panels.elements.createSidebarPane('LocatorHub', function(sidebar) {
  sidebar.setPage('panel.html');

  sidebar.onShown.addListener(function(win) {
    // Called when user switches to the LocatorHub tab.
    // win is the Window object of the sidebar iframe.
    if (win && typeof win.locatorHubRefresh === 'function') {
      win.locatorHubRefresh(); // triggers re-analysis without re-selecting element
    }
  });
});

// panel.js (bottom)
window.locatorHubRefresh = analyzeElement; // exposed for devtools.js to call
```

This ensures results appear immediately when the user clicks the LocatorHub tab, even if they selected the element while looking at a different sidebar tab.

---

## 12. Return payload shape

The engine returns a single `JSON.stringify()` call. The panel parses it and never re-evaluates anything.

```jsonc
{
  "elementInfo": {
    "tag": "button",
    "id": "submit-btn",
    "classes": ["btn", "btn-primary"],
    "attrs": { "type": "submit", "aria-label": "Submit form" }
  },
  "locators": [
    {
      "strategy": "ID",
      "locator": "#submit-btn",
      "method": "css",
      "count": 1,       // live match count from querySelectorAll
      "fragile": false,
      "rank": 1
    }
    // … up to 15 entries, sorted by score ascending
  ],
  "events": {
    "click": [
      { "name": "handleSubmit", "capture": false, "passive": false, "once": false }
    ]
  },
  "styles": {
    "inline": "color: red;",
    "computed": {
      "display": "inline-flex",
      "visibility": "visible"
      // … ~30 automation-relevant properties
    }
  }
}
```
