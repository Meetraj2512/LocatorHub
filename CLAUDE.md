# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LocatorHub is a Chrome Extension (Manifest V3) that adds a DevTools panel for SDETs. When the user selects any element in the DevTools Elements panel, the extension generates, validates, and ranks element locators for Selenium/Playwright — plus shows event listeners and computed styles for the element. No external libraries; vanilla JS only.

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
3. Then close and reopen DevTools to reload the panel

## Layout

The panel is a two-column split with a draggable divider (default 55/45):

- **Left panel** (`#left-panel`) — locators grouped into Recommended / Acceptable / Fragile / Invalid
- **Right panel** (`#right-panel`) — two sections stacked vertically:
  - **Event Listeners** — collapsible per event type; shows handler name + `capture`/`passive`/`once` flags; uses `getEventListeners($0)` (DevTools API, may not be available on some pages)
  - **Styles** — inline `style` attribute parsed into rows, then computed styles in automation-relevant priority order; color-value rows get a small inline swatch

`body` is a column flex container; `#main-split` is a row flex with `flex:1` so the split fills remaining height. The divider drag resize is handled in an IIFE at the bottom of `panel.js`.

`.group-header` and `.right-section-hdr` both use `position: sticky; top: 0` — this sticks within their respective scrolling containers (`#left-panel` and `#right-panel`), not the whole viewport.

## Architecture

### Two JavaScript contexts

The extension spans two completely separate JS contexts that cannot share memory:

| Context | Files | What runs here |
|---|---|---|
| **DevTools extension page** | `panel.html`, `panel.js` | UI rendering, clipboard, `chrome.devtools.*` APIs |
| **Inspected page** | *(injected at runtime)* | DOM queries, `$0`, `getEventListeners`, `getComputedStyle`, `querySelectorAll` |

The bridge between them is `chrome.devtools.inspectedWindow.eval(script, callback)`. The result crosses the boundary as a JSON string.

### The eval trick in panel.js

`__locatorEngine` is a real JS function defined at the top of `panel.js` but **never called there**. It exists solely so its regex literals and logic survive `.toString()` intact — avoiding the backslash-doubling problem that template literals impose on `\d`, `\[`, etc.

```js
var LOCATOR_ENGINE = '(' + __locatorEngine.toString() + ')()';
// → eval'd in the inspected page where $0 and getEventListeners are available
```

`$0` is accessed inside the function via `(typeof $0 !== 'undefined') ? $0 : null`, which is safe at definition time (no ReferenceError) because `typeof` never throws on undefined identifiers.

### Locator strategy priority (inside `__locatorEngine`)

Strategies run in this fixed order; a dedup map (`seen`) prevents duplicate selector strings:

1. `#id` CSS
2. `[data-testid]`, `[data-cy]`, `[data-qa]`, `[data-test]` CSS
3. `[aria-label]` CSS
4. `[name]` CSS
5. `tag.stable-class.combo` CSS — filters classes through `isAutoGenClass()`
6. Ancestor-anchored CSS — walks up ≤10 ancestors, anchors at first `#id` or test-attr
7. XPath with stable attributes (`name`, `type`, `placeholder`, `role`, `href`, `title`)
8. XPath with direct text content (text nodes only, ≤50 chars)
9. Ancestor-anchored XPath — same walk as #6, builds `//*[@id="x"]/div/button` style path
10. `nth-of-type` CSS path — last resort, always fragile

### Category rules

| count | fragile | category |
|---|---|---|
| < 0 (error) | any | invalid |
| 0 | any | invalid |
| 1 | false | **recommended** |
| 1 | true | acceptable |
| > 1 | false | acceptable |
| > 1 | true | invalid |

### Auto-generated class detection (`isAutoGenClass`)

A class is treated as auto-generated (excluded from strategy #5) if it matches any of:
- 6+ consecutive hex chars — e.g. `abc123f`
- 4+ consecutive digits
- Pattern `xx-XXXXX` with 2–4 char prefix + 5+ alphanums + at least one digit — CSS-in-JS like `sc-bhXjX`
- Underscore-prefix hash like `_3x1a2b`

### Fragility detection

XPath is fragile if it starts with `/html` (absolute) or contains `[N]` (positional index).  
CSS is fragile if it uses `:nth-child` or `:nth-of-type`.

### Data flow

```
onSelectionChanged / Refresh button
        │
        ▼
  analyzeElement()            ← panel.js (DevTools context)
        │ chrome.devtools.inspectedWindow.eval(LOCATOR_ENGINE)
        ▼
  __locatorEngine()            ← runs in inspected page
  → collects locators, getEventListeners($0), getComputedStyle(el)
  → returns JSON.stringify({ elementInfo, locators[], events, styles })
        │
        ▼
  renderResults(data)          ← panel.js parses JSON, updates DOM
    ├─ renderElemBar()
    ├─ renderGroup() × 3       ← left panel
    ├─ renderEventListeners()  ← right panel
    └─ renderStyles()          ← right panel
```

## Key constraints

- **No external libraries.** No npm, no bundler, no CDN. Everything is vanilla JS.
- **No background service worker.** All communication goes through `inspectedWindow.eval()`; no content script needed.
- **ES5 inside `__locatorEngine`.** The eval'd code uses `var`, `for` loops, and IIFEs for maximum compatibility with the inspected page's context. Panel controller code (outside the function) may use ES6+.
- **Attribute value quoting.** CSS attribute selectors use `cssAttrQuote()` (escapes `\` and `"`). XPath predicates use `xpathQuote()` which handles values containing both `'` and `"` via XPath `concat()`.
