# LocatorHub

A Chrome DevTools sidebar extension that generates, validates, and ranks element locators for **Selenium** and **Playwright** test automation — directly inside the Elements panel.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue?logo=googlechrome) ![Manifest V3](https://img.shields.io/badge/Manifest-V3-green) ![Vanilla JS](https://img.shields.io/badge/Vanilla-JS-yellow)

---

## What it does

Select any element in the DevTools Elements panel and LocatorHub instantly:

- Generates up to **15 ranked locators** across every strategy (ID, test attributes, aria-label, XPath, CSS, ancestor-anchored, sibling-based, descendant-contains)
- **Validates each locator live** against the page and shows exact match count
- **Ranks them** from most stable (rank 1) to last resort (rank 15) using a scoring formula that weighs uniqueness, strategy reliability, and fragility
- Scans **10 ancestor levels** and **10 descendant elements** for anchor-based locators
- Detects and flags **fragile locators** (positional selectors, auto-generated classes, absolute XPath)
- Shows **Event Listeners** and **Computed Styles** for the selected element in the same panel

---

## Locator strategies (in priority order)

| Rank | Strategy | Example |
|------|----------|---------|
| 1 | ID (CSS) | `#submit-btn` |
| 2 | ID (XPath) | `//*[@id='submit-btn']` |
| 3–6 | Test attributes | `[data-testid="submit"]` |
| 7 | aria-label | `[aria-label="Submit form"]` |
| 8 | name attribute | `[name="username"]` |
| 9 | Ancestor-anchored CSS | `#login-form input[type="text"]` |
| 10 | Ancestor-anchored XPath | `//*[@id='login-form']//input` |
| 11 | XPath by attributes | `//input[@type='email' and @name='email']` |
| 12 | XPath by direct text | `//button[normalize-space(text())='Sign in']` |
| 13 | Contains-descendant XPath | `//div[.//button[@data-testid='ok']]` |
| 14 | Sibling label XPath | `//label[text()='Email']/following-sibling::input[1]` |
| 15 | Stable class combo | `input.form-control.email-field` |
| – | nth-of-type CSS | `div > section:nth-of-type(2) > input` *(last resort)* |

---

## Installation

> No build step required — load the folder directly.

1. Clone or download this repository
2. Run `node create-icons.js` to generate the extension icons
3. Open Chrome and go to `chrome://extensions`
4. Enable **Developer mode** (top-right toggle)
5. Click **Load unpacked** and select the `LocatorHub/` folder
6. Open any webpage → open DevTools → click the **LocatorHub** tab in the right sidebar (next to *Event Listeners* and *DOM Breakpoints*)

---

## Usage

1. Open DevTools on any page (`F12` or right-click → Inspect)
2. Go to the **Elements** panel
3. Click the **LocatorHub** tab in the right sidebar
4. Click any element in the DOM tree
5. Locators appear instantly, ranked 1–15 with live match counts
6. Click **Copy** on any row to copy the locator to clipboard
7. Scroll down for **Event Listeners** and **Styles** for the selected element
8. Click **↻ Refresh** to re-analyse the current element

---

## Ranking explained

Each locator is scored with:

```
score = match_penalty + strategy_priority + fragility_penalty

match_penalty:   0       (1 match — unique)
                 N × 100 (N matches — ambiguous)
                 9000    (0 or error — invalid)

strategy_priority: 1 (ID) → 20 (nth-of-type)

fragility_penalty: 50 if selector uses positional index or absolute path
```

Lower score = better rank. The top 15 candidates are shown.

---

## Match count badges

| Badge | Meaning |
|-------|---------|
| **1 match** (green) | Uniquely identifies one element — safe to use |
| **N matches** (yellow) | Ambiguous — may click the wrong element |
| **0 matches** (red) | Broken locator — element not found |

---

## Fragility detection

A locator is flagged ⚡ **Fragile** if it:
- Uses `:nth-child` or `:nth-of-type` (breaks when DOM order changes)
- Contains a positional XPath index like `div[3]`
- Starts with `/html/body` (absolute XPath)
- Uses auto-generated class names (hex hashes, CSS-in-JS patterns like `sc-bhXjX`)

---

## Good demo sites to test with

| Site | What it tests |
|------|--------------|
| `saucedemo.com` | `data-test` attributes → rank 1 locators |
| `demoqa.com` | Forms, labels, nested elements |
| `the-internet.herokuapp.com` | Bare HTML without test attributes → XPath fallbacks |
| `uitestingplayground.com` | Dynamic IDs, hidden elements, tricky locators |
| `parabank.parasoft.com` | Label-associated inputs → sibling XPath |

---

## Project structure

```
LocatorHub/
├── manifest.json       Chrome Extension manifest (MV3)
├── devtools.html       DevTools entry point
├── devtools.js         Registers the sidebar pane
├── panel.html          Sidebar UI + styles
├── panel.js            Locator engine + panel controller
├── create-icons.js     Node script to generate PNG icons
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Requirements

- Chrome 88+ (Manifest V3 support)
- Node.js (only needed once, to run `create-icons.js`)
- No npm packages or build tools required

---

## License

MIT
