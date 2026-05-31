# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LocatorHub is a Chrome Extension (Manifest V3) **sidebar pane** that lives inside the DevTools Elements panel (next to Styles / Event Listeners / DOM Breakpoints). When the user selects any element, the extension generates up to 15 ranked locators for Selenium/Playwright, validates each live against the page, and also shows event listeners and computed styles. No external libraries; vanilla JS only.

## Development commands

```bash
# Regenerate the three PNG icons (run once, or after changing create-icons.js)
node create-icons.js

# Syntax-check JS files without running them
node --check panel.js
node --check create-icons.js
```

**No build step.** Load the directory directly in Chrome:
1. `chrome://extensions` → enable Developer mode → Load unpacked → select this folder
2. After any file change: click the ↻ reload button on the extension card in `chrome://extensions`
3. Close and reopen DevTools — the sidebar pane reloads with it

## Layout (single scrollable column)

The panel is a **sidebar pane** registered via `chrome.devtools.panels.elements.createSidebarPane()` in `devtools.js`. It is not a top-level DevTools tab.

`panel.html` is a single scrollable column (`body` → column flex, `#header` sticky, `#content` scrollable). Sections stack vertically:

```
#header          sticky element info bar + ↻ Refresh
#content
  #status / #loading         empty/loading state
  #results
    #results-meta            "N locators — M unique match"
    #locator-list            ranked rows (rank 1 = best)
  #events-area               ⚡ Event Listeners (collapsible per type)
  #styles-area               🎨 Styles (Inline + Computed sub-sections)
```

All `section-hdr` elements use `position: sticky; top: 0` — they stick within `#content`'s scroll context, not the whole viewport.

## Architecture

### Two JavaScript contexts

| Context | Files | APIs available |
|---|---|---|
| **DevTools extension page** | `panel.html`, `panel.js` | `chrome.devtools.*`, clipboard, DOM rendering |
| **Inspected page** (eval'd at runtime) | inside `__locatorEngine` | `$0`, `getEventListeners`, `getComputedStyle`, `querySelectorAll`, `document.evaluate` |

The bridge is `chrome.devtools.inspectedWindow.eval(script, callback)`. Result crosses the boundary as a **JSON string** (the engine returns `JSON.stringify({...})`).

### The eval trick in panel.js

`__locatorEngine` is a real JS function defined at the top of `panel.js` but **never called there**. It is stringified via `.toString()` and wrapped in an IIFE for eval:

```js
var LOCATOR_ENGINE = '(' + __locatorEngine.toString() + ')()';
```

This preserves regex literals exactly (e.g. `/\d{4,}/`) — template literal strings would silently mangle backslashes. `$0` is accessed inside as `(typeof $0 !== 'undefined') ? $0 : null` — safe because `typeof` never throws on undeclared identifiers.

**ES5 only inside `__locatorEngine`** — uses `var`, `for` loops, IIFEs. Panel controller code outside the function may use ES6+.

### Sidebar auto-refresh

`devtools.js` wires `sidebar.onShown` → calls `win.locatorHubRefresh()` (exposed as `window.locatorHubRefresh = analyzeElement` in `panel.js`). This triggers re-analysis when the user switches back to the LocatorHub tab with an element already selected, without needing to re-select it.

## Locator engine (`__locatorEngine`)

### Constants (top of function)

```js
var MAX_LOCATORS     = 15;   // cap on returned locators
var ANCESTOR_DEPTH   = 10;   // how many levels up to walk
var DESCENDANT_LIMIT = 10;   // how many descendants to scan
```

### Strategy generation

All candidates go into a `candidates[]` array via `add(strategy, selector, method)`. A `seen{}` map deduplicates exact selector strings. Strategies, in generation order:

| # | Strategy | Method | Source |
|---|---|---|---|
| 1 | ID | CSS `#id` | element itself |
| 2 | ID (XPath) | XPath `//*[@id='...']` | element itself |
| 3–6 | data-testid / data-cy / data-qa / data-test | CSS attr | element itself |
| 7 | aria-label | CSS attr | element itself |
| 8 | name | CSS attr | element itself |
| 9 | XPath (attrs) | XPath | up to 3 stable attrs combined |
| 10 | XPath (text) | XPath | direct text nodes, ≤60 chars |
| 11 | full text XPath | XPath | `normalize-space(.)` — all inner text |
| 12 | class combo | CSS | stable classes only (filtered by `isAutoGenClass`) |
| 13 | ancestor CSS | CSS | walk up to 10 ancestors; anchor at each `#id` or test-attr found |
| 14 | ancestor XPath | XPath | same walk, build path down from anchor to element |
| 15 | contains attr | XPath | breadth-first TreeWalker, up to 10 descendants; if any has `id`/test-attr, generate `//tag[.//child[@id='...']]` |
| 16 | sibling XPath | XPath | preceding `<label>` with text → `//label[text()='...']/following-sibling::tag[1]` |
| 17 | nth-of-type | CSS | full path as last resort |

**Important:** ancestor CSS/XPath generate a separate candidate for *each* stable ancestor found (not just the nearest). This means multiple ancestor-anchored locators may appear at different depths — the ranking algorithm picks the best one(s).

### Scoring and ranking

After generation, every candidate is scored:

```
score = match_penalty + strategy_priority + fragility_penalty

match_penalty:
  count === 1  →  0        (unique — ideal)
  count > 1    →  count × 100
  count ≤ 0    →  9000     (invalid/error)

strategy_priority:  ID=1, ID(XPath)=2, data-testid=3 … nth-of-type=20
fragility_penalty:  50 if fragile, else 0
```

Candidates sorted ascending by score → top 15 kept → `rank` field assigned (1 = best).

### Fragility detection (`isFragile`)

A locator is marked fragile (`⚡`) if:
- XPath starts with `/html` — absolute path
- XPath contains `[N]` where N is a digit — positional index
- CSS uses `:nth-child` or `:nth-of-type`

Fragile locators are **still shown** (they may be the only option) but score 50 points worse and appear lower in the ranked list.

### Auto-generated class detection (`isAutoGenClass`)

A class is excluded from the class-combo strategy if it matches any of:
- 6+ consecutive hex chars — e.g. `abc123f`
- 4+ consecutive digits
- 2–4 char prefix + `-` + 5+ alphanums with at least one digit — CSS-in-JS like `sc-bhXjX`
- Underscore-prefix hash — `_3x1a2b`

### Quoting helpers

- `cssAttrQuote(v)` — wraps in `"..."`, escapes `\` and `"` for CSS attribute selectors
- `xpathQuote(v)` — uses single quotes normally; falls back to double quotes if value contains `'`; uses XPath `concat()` if value contains both

### Return value

```json
{ "elementInfo": { "tag", "id", "classes", "attrs" },
  "locators": [ { "strategy", "locator", "method", "count", "fragile", "rank" }, … ],
  "events": { "click": [ { "name", "capture", "passive", "once" } ], … } | null,
  "styles": { "inline": "cssText", "computed": { "property": "value" } } }
```

## Data flow

```
onSelectionChanged  /  Refresh button  /  sidebar.onShown
        │
        ▼
  analyzeElement()                     ← panel.js (DevTools context)
        │  chrome.devtools.inspectedWindow.eval(LOCATOR_ENGINE)
        ▼
  __locatorEngine()                    ← runs in inspected page
  → generates all candidates, scores, keeps top 15, collects events + styles
  → returns JSON string
        │
        ▼
  renderResults(data)                  ← panel.js
    ├─ renderElemBar(data.elementInfo)
    ├─ renderRankedList(data.locators) → #results-meta + #locator-list
    ├─ renderEventListeners(data.events)
    └─ renderStyles(data.styles)
```

## Key constraints

- **No external libraries.** No npm, no bundler, no CDN.
- **No background service worker.** All communication via `inspectedWindow.eval()`.
- **No `system_instruction`** in any Gemini/LLM API call — the `v1` endpoint doesn't support it; inject context as the first user turn instead.
- **Attribute value quoting** must use `cssAttrQuote()` for CSS and `xpathQuote()` for XPath — never raw string interpolation.
- **`.env` is git-ignored.** Never commit tokens or API keys.
