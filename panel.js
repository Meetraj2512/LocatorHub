'use strict';

/* ─────────────────────────────────────────────────────────────────────────────
   LOCATOR ENGINE
   Defined as a real function so regex literals survive .toString() correctly.
   Never called here — stringified and eval'd in the inspected page context
   where $0 and getEventListeners() (DevTools API) are available.
───────────────────────────────────────────────────────────────────────────── */
function __locatorEngine() {
  /* jshint ignore:start */
  var el = (typeof $0 !== 'undefined') ? $0 : null;
  /* jshint ignore:end */
  if (!el || !el.tagName) return JSON.stringify({ error: 'No element selected' });

  var MAX_LOCATORS = 15;
  var ANCESTOR_DEPTH = 10;
  var DESCENDANT_LIMIT = 10;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function cssAttrQuote(v) {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function xpathQuote(v) {
    if (v.indexOf("'") === -1) return "'" + v + "'";
    if (v.indexOf('"') === -1) return '"' + v + '"';
    return "concat('" + v.split("'").join("',\"'\",'") + "')";
  }

  function isAutoGenClass(c) {
    if (/[a-f0-9]{6,}/i.test(c)) return true;
    if (/\d{4,}/.test(c)) return true;
    if (/^[a-z]{2,4}-[a-zA-Z0-9]{5,}$/i.test(c) && /\d/.test(c)) return true;
    if (/^_[a-zA-Z0-9]{4,}$/.test(c)) return true;
    return false;
  }

  function countMatches(method, selector) {
    try {
      if (method === 'css') return document.querySelectorAll(selector).length;
      if (method === 'xpath') {
        return document.evaluate(
          selector, document, null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        ).snapshotLength;
      }
    } catch (e) { return -1; }
    return -1;
  }

  function isFragile(method, selector) {
    if (method === 'xpath') {
      if (/^\/html/i.test(selector)) return true;
      if (/\[\d+\]/.test(selector))  return true;
    }
    if (method === 'css') {
      if (/:nth-child/.test(selector))   return true;
      if (/:nth-of-type/.test(selector)) return true;
    }
    return false;
  }

  // Strategy base priority (lower = more stable/preferred)
  var STRATEGY_PRIORITY = {
    'ID':                  1,
    'ID (XPath)':          2,
    'data-testid':         3,
    'data-cy':             4,
    'data-qa':             5,
    'data-test':           6,
    'aria-label':          7,
    'name':                8,
    'ancestor CSS':        9,
    'ancestor XPath':     10,
    'XPath (attrs)':      11,
    'XPath (text)':       12,
    'contains attr':      13,
    'sibling XPath':      14,
    'class combo':        15,
    'full text XPath':    16,
    'nth-of-type':        20
  };

  // Score: lower = better rank. Sort key = match penalty + strategy priority + fragility
  function computeScore(loc) {
    var matchPenalty;
    if (loc.count < 0 || loc.count === 0) matchPenalty = 9000;
    else if (loc.count === 1) matchPenalty = 0;
    else matchPenalty = loc.count * 100;
    return matchPenalty + (STRATEGY_PRIORITY[loc.strategy] || 10) + (loc.fragile ? 50 : 0);
  }

  var candidates = [];
  var seen = {};

  function add(strategy, selector, method) {
    if (!selector || seen[selector]) return;
    seen[selector] = true;
    var count   = countMatches(method, selector);
    var fragile = isFragile(method, selector);
    candidates.push({ strategy: strategy, locator: selector, method: method, count: count, fragile: fragile });
  }

  var testAttrs = ['data-testid', 'data-cy', 'data-qa', 'data-test'];
  var tag = el.tagName.toLowerCase();
  var i, val;

  // ── 1. ID ─────────────────────────────────────────────────────────────────
  if (el.id) {
    try { add('ID', '#' + CSS.escape(el.id), 'css'); } catch (e) {}
    add('ID (XPath)', '//*[@id=' + xpathQuote(el.id) + ']', 'xpath');
  }

  // ── 2. Test data attributes ───────────────────────────────────────────────
  for (i = 0; i < testAttrs.length; i++) {
    val = el.getAttribute(testAttrs[i]);
    if (val) add(testAttrs[i], '[' + testAttrs[i] + '=' + cssAttrQuote(val) + ']', 'css');
  }

  // ── 3. aria-label ─────────────────────────────────────────────────────────
  val = el.getAttribute('aria-label');
  if (val) add('aria-label', '[aria-label=' + cssAttrQuote(val) + ']', 'css');

  // ── 4. name ───────────────────────────────────────────────────────────────
  val = el.getAttribute('name');
  if (val) add('name', '[name=' + cssAttrQuote(val) + ']', 'css');

  // ── 5. XPath by stable attributes ─────────────────────────────────────────
  (function () {
    var parts = [];
    var xAttrs = ['name', 'type', 'placeholder', 'role', 'href', 'title'];
    for (var j = 0; j < xAttrs.length && parts.length < 3; j++) {
      var xv = el.getAttribute(xAttrs[j]);
      if (xv) parts.push('@' + xAttrs[j] + '=' + xpathQuote(xv));
    }
    if (parts.length > 0) add('XPath (attrs)', '//' + tag + '[' + parts.join(' and ') + ']', 'xpath');
  }());

  // ── 6. Direct text XPath ──────────────────────────────────────────────────
  (function () {
    var directText = '';
    for (var j = 0; j < el.childNodes.length; j++) {
      if (el.childNodes[j].nodeType === 3) directText += el.childNodes[j].textContent;
    }
    directText = directText.trim();
    if (directText && directText.length >= 2 && directText.length <= 60) {
      add('XPath (text)', '//' + tag + '[normalize-space(text())=' + xpathQuote(directText) + ']', 'xpath');
    }
    // Full inner text (includes descendants)
    var fullText = (el.textContent || '').trim();
    if (fullText && fullText !== directText && fullText.length >= 2 && fullText.length <= 60) {
      add('full text XPath', '//' + tag + '[normalize-space(.)=' + xpathQuote(fullText) + ']', 'xpath');
    }
  }());

  // ── 7. Stable class combination ───────────────────────────────────────────
  if (el.classList && el.classList.length > 0) {
    var stable = [];
    for (i = 0; i < el.classList.length; i++) {
      if (!isAutoGenClass(el.classList[i])) stable.push(el.classList[i]);
    }
    if (stable.length > 0) {
      try {
        add('class combo', tag + '.' + stable.map(function (c) { return CSS.escape(c); }).join('.'), 'css');
      } catch (e) {}
    }
  }

  // ── 8. Ancestors — walk up to ANCESTOR_DEPTH levels ──────────────────────
  // CSS: try every ancestor that has a stable anchor, generate multiple variants
  // XPath: same walk, build path down to element
  (function () {
    var ancestor = el.parentElement;
    var cssTail  = tag;
    var depth    = 0;

    while (ancestor && ancestor !== document.documentElement && depth < ANCESTOR_DEPTH) {
      depth++;

      if (ancestor.id) {
        try {
          add('ancestor CSS', '#' + CSS.escape(ancestor.id) + ' ' + cssTail, 'css');
        } catch (e) {}
        // Also build XPath path down from this ancestor
        var xDown = '', node = el;
        while (node !== ancestor) {
          xDown = '/' + node.tagName.toLowerCase() + xDown;
          node  = node.parentElement;
          if (!node) { xDown = ''; break; }
        }
        if (xDown) add('ancestor XPath', '//*[@id=' + xpathQuote(ancestor.id) + ']' + xDown, 'xpath');
      }

      for (var j = 0; j < testAttrs.length; j++) {
        var av = ancestor.getAttribute(testAttrs[j]);
        if (av) {
          add('ancestor CSS', '[' + testAttrs[j] + '=' + cssAttrQuote(av) + '] ' + cssTail, 'css');
          var xDown2 = '', node2 = el;
          while (node2 !== ancestor) {
            xDown2 = '/' + node2.tagName.toLowerCase() + xDown2;
            node2  = node2.parentElement;
            if (!node2) { xDown2 = ''; break; }
          }
          if (xDown2) add('ancestor XPath', '//*[@' + testAttrs[j] + '=' + xpathQuote(av) + ']' + xDown2, 'xpath');
          break;
        }
      }

      cssTail  = ancestor.tagName.toLowerCase() + ' ' + cssTail;
      ancestor = ancestor.parentElement;
    }
  }());

  // ── 9. Descendants — look up to DESCENDANT_LIMIT elements below ───────────
  // If a descendant has a unique stable attr, we can anchor the parent by it.
  (function () {
    var walker = document.createTreeWalker(el, 1 /* SHOW_ELEMENT */, null, false);
    var desc, count = 0;
    while ((desc = walker.nextNode()) && count < DESCENDANT_LIMIT) {
      count++;
      var dtag = desc.tagName.toLowerCase();
      if (desc.id) {
        add('contains attr', '//' + tag + '[.//' + dtag + '[@id=' + xpathQuote(desc.id) + ']]', 'xpath');
        break;
      }
      for (var j = 0; j < testAttrs.length; j++) {
        var dv = desc.getAttribute(testAttrs[j]);
        if (dv) {
          add('contains attr', '//' + tag + '[.//' + dtag + '[@' + testAttrs[j] + '=' + xpathQuote(dv) + ']]', 'xpath');
          break;
        }
      }
    }
  }());

  // ── 10. Sibling context ───────────────────────────────────────────────────
  // Preceding label with text → following-sibling input pattern
  (function () {
    var sib = el.previousElementSibling;
    for (var s = 0; s < 3 && sib; s++) {
      if (sib.tagName === 'LABEL') {
        var lblText = (sib.textContent || '').trim();
        if (lblText && lblText.length <= 50) {
          add('sibling XPath',
            '//label[normalize-space(text())=' + xpathQuote(lblText) + ']/following-sibling::' + tag + '[1]',
            'xpath');
        }
        break;
      }
      // Also try aria-labelledby
      var lblId = sib.id;
      if (lblId && el.getAttribute('aria-labelledby') === lblId) {
        add('sibling XPath', '//' + tag + '[@aria-labelledby=' + xpathQuote(lblId) + ']', 'xpath');
        break;
      }
      sib = sib.previousElementSibling;
    }
  }());

  // ── 11. nth-of-type CSS (last resort) ────────────────────────────────────
  (function () {
    try {
      var parts = [], cur = el, depth = 0;
      while (cur && cur !== document.documentElement && cur !== document.body && depth < 12) {
        depth++;
        var ctag   = cur.tagName.toLowerCase();
        var parent = cur.parentElement;
        if (!parent) break;
        var sibs = [];
        for (var j = 0; j < parent.children.length; j++) {
          if (parent.children[j].tagName === cur.tagName) sibs.push(parent.children[j]);
        }
        var idx = sibs.indexOf(cur) + 1;
        parts.unshift(sibs.length > 1 ? ctag + ':nth-of-type(' + idx + ')' : ctag);
        cur = parent;
      }
      if (parts.length > 0) add('nth-of-type', parts.join(' > '), 'css');
    } catch (e) {}
  }());

  // ── Score, rank, cap at MAX_LOCATORS ─────────────────────────────────────
  candidates.sort(function (a, b) { return computeScore(a) - computeScore(b); });
  var locators = candidates.slice(0, MAX_LOCATORS).map(function (l, idx) {
    l.rank = idx + 1;
    return l;
  });

  // ── Element info ──────────────────────────────────────────────────────────
  var info = { tag: tag, id: el.id || '', classes: [], attrs: {} };
  for (var ci = 0; ci < el.classList.length; ci++) info.classes.push(el.classList[ci]);
  var infoKeys = ['type','name','placeholder','href','src','aria-label','data-testid','data-cy','data-qa','role','value','alt'];
  for (var ki = 0; ki < infoKeys.length; ki++) {
    var kv = el.getAttribute(infoKeys[ki]);
    if (kv) info.attrs[infoKeys[ki]] = kv;
  }

  // ── Event listeners ───────────────────────────────────────────────────────
  var events = null;
  try {
    if (typeof getEventListeners === 'function') {
      var raw = getEventListeners(el);
      events = {};
      var etypes = Object.keys(raw);
      for (var ei = 0; ei < etypes.length; ei++) {
        var etype = etypes[ei];
        events[etype] = raw[etype].map(function (l) {
          return { name: (l.listener && l.listener.name) ? l.listener.name : '(anonymous)',
                   capture: !!l.useCapture, passive: !!l.passive, once: !!l.once };
        });
      }
    }
  } catch (e) { events = null; }

  // ── Computed styles ───────────────────────────────────────────────────────
  var styles = { inline: '', computed: {} };
  try {
    styles.inline = el.style.cssText || '';
    var cs = window.getComputedStyle(el);
    var csKeys = [
      'display','visibility','opacity','pointer-events','cursor',
      'position','z-index','top','left','right','bottom',
      'width','height','overflow','overflow-x','overflow-y',
      'color','background-color','border','border-radius',
      'font-size','font-weight','font-family',
      'padding','margin',
      'flex','flex-direction','align-items','justify-content',
      'transform','transition','box-shadow'
    ];
    for (var csi = 0; csi < csKeys.length; csi++) {
      var cv = cs.getPropertyValue(csKeys[csi]);
      if (cv) styles.computed[csKeys[csi]] = cv;
    }
  } catch (e) {}

  return JSON.stringify({ elementInfo: info, locators: locators, events: events, styles: styles });
}

var LOCATOR_ENGINE = '(' + __locatorEngine.toString() + ')()';

/* ─────────────────────────────────────────────────────────────────────────────
   DOM REFS
───────────────────────────────────────────────────────────────────────────── */
var statusEl      = document.getElementById('status');
var loadingEl     = document.getElementById('loading');
var resultsEl     = document.getElementById('results');
var eventsArea    = document.getElementById('events-area');
var stylesArea    = document.getElementById('styles-area');
var elemTag       = document.getElementById('elem-tag');
var elemId        = document.getElementById('elem-id');
var elemCls       = document.getElementById('elem-cls');
var elemAttrs     = document.getElementById('elem-attrs');
var eventsList    = document.getElementById('events-list');
var stylesContent = document.getElementById('styles-content');
var cntEvents     = document.getElementById('cnt-events');
var locatorList   = document.getElementById('locator-list');
var resultsMeta   = document.getElementById('results-meta');

/* ─────────────────────────────────────────────────────────────────────────────
   PANEL STATE
───────────────────────────────────────────────────────────────────────────── */
function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.classList.remove('hidden');
  loadingEl.classList.add('hidden');
  resultsEl.classList.add('hidden');
  eventsArea.classList.add('hidden');
  stylesArea.classList.add('hidden');
  clearElemBar();
}

function showLoading() {
  statusEl.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  resultsEl.classList.add('hidden');
}

function showResults() {
  statusEl.classList.add('hidden');
  loadingEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  eventsArea.classList.remove('hidden');
  stylesArea.classList.remove('hidden');
}

/* ─────────────────────────────────────────────────────────────────────────────
   ELEMENT INFO BAR
───────────────────────────────────────────────────────────────────────────── */
function clearElemBar() {
  elemTag.textContent = '';
  elemId.textContent  = '';
  elemCls.textContent = '';
  elemAttrs.innerHTML = '';
}

function renderElemBar(info) {
  elemTag.textContent = '<' + info.tag + '>';
  elemId.textContent  = info.id ? '#' + info.id : '';
  var visClasses = info.classes.slice(0, 3);
  elemCls.textContent = visClasses.length ? '.' + visClasses.join('.') : '';

  elemAttrs.innerHTML = '';
  var attrOrder = ['type','role','name','placeholder','aria-label','data-testid','data-cy','data-qa','href','alt'];
  var shown = 0;
  for (var i = 0; i < attrOrder.length && shown < 3; i++) {
    var k = attrOrder[i];
    if (info.attrs[k]) {
      var pill = document.createElement('span');
      pill.className = 'elem-attr';
      var display = k + '="' + info.attrs[k] + '"';
      pill.textContent = display.length > 24 ? display.slice(0, 23) + '…' : display;
      pill.title = k + '="' + info.attrs[k] + '"';
      elemAttrs.appendChild(pill);
      shown++;
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   RANKED LOCATOR LIST
───────────────────────────────────────────────────────────────────────────── */
function flashCopied(btn) {
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
}

function rankClass(rank) {
  if (rank <= 5)  return 'rank-top';
  if (rank <= 10) return 'rank-mid';
  return 'rank-low';
}

function matchBadgeClass(count) {
  if (count < 0)  return 'error';
  if (count === 0) return 'none';
  if (count === 1) return 'unique';
  return 'multiple';
}

function matchBadgeText(count) {
  if (count < 0)  return 'Err';
  if (count === 0) return '0';
  return count.toString();
}

function renderLocatorRow(loc) {
  var row = document.createElement('div');
  row.className = 'locator-row';

  // Rank badge
  var rank = document.createElement('span');
  rank.className = 'rank-badge ' + rankClass(loc.rank);
  rank.textContent = loc.rank;
  row.appendChild(rank);

  // Strategy label
  var badge = document.createElement('span');
  badge.className = 'strategy-badge';
  badge.textContent = loc.strategy;
  row.appendChild(badge);

  // Locator string
  var str = document.createElement('span');
  str.className = 'locator-str';
  str.textContent = loc.locator;
  str.title = loc.locator;
  row.appendChild(str);

  // Match count — prominent number badge
  var mc = document.createElement('span');
  mc.className = 'match-count ' + matchBadgeClass(loc.count);
  mc.title = loc.count < 0 ? 'Selector error' : loc.count + ' element(s) matched on page';

  var mcNum = document.createElement('span');
  mcNum.className = 'mc-num';
  mcNum.textContent = matchBadgeText(loc.count);

  var mcLabel = document.createElement('span');
  mcLabel.className = 'mc-label';
  mcLabel.textContent = loc.count === 1 ? 'match' : 'matches';

  mc.appendChild(mcNum);
  mc.appendChild(mcLabel);
  row.appendChild(mc);

  // Fragile indicator
  if (loc.fragile) {
    var fp = document.createElement('span');
    fp.className = 'fragile-pill';
    fp.textContent = '⚡';
    fp.title = 'Fragile — uses positional index or absolute path';
    row.appendChild(fp);
  }

  // Copy button
  var copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', function () {
    navigator.clipboard.writeText(loc.locator)
      .then(function () { flashCopied(copyBtn); })
      .catch(function () {
        var ta = document.createElement('textarea');
        ta.value = loc.locator;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        flashCopied(copyBtn);
      });
  });
  row.appendChild(copyBtn);
  return row;
}

function renderRankedList(locators) {
  locatorList.innerHTML = '';
  var total   = locators.length;
  var unique  = locators.filter(function (l) { return l.count === 1; }).length;
  resultsMeta.textContent = total + ' locators — ' + unique + ' unique match';
  locators.forEach(function (loc) { locatorList.appendChild(renderLocatorRow(loc)); });
}

/* ─────────────────────────────────────────────────────────────────────────────
   EVENT LISTENERS
───────────────────────────────────────────────────────────────────────────── */
function renderEventListeners(events) {
  eventsList.innerHTML = '';
  if (!events) {
    var note = document.createElement('div');
    note.className = 'empty-group';
    note.textContent = 'getEventListeners() not available for this page';
    eventsList.appendChild(note);
    cntEvents.textContent = '';
    return;
  }
  var types = Object.keys(events);
  if (types.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty-group';
    empty.textContent = 'No event listeners on this element';
    eventsList.appendChild(empty);
    cntEvents.textContent = '';
    return;
  }
  var total = types.reduce(function (n, t) { return n + events[t].length; }, 0);
  cntEvents.textContent = total;

  types.forEach(function (type) {
    var handlers = events[type];

    var typeRow = document.createElement('div');
    typeRow.className = 'event-type-row';

    var chevron = document.createElement('span');
    chevron.className = 'event-chevron open';
    chevron.textContent = '▶';
    typeRow.appendChild(chevron);

    var typeName = document.createElement('span');
    typeName.className = 'event-type-name';
    typeName.textContent = type;
    typeRow.appendChild(typeName);

    var badge = document.createElement('span');
    badge.className = 'event-count-badge';
    badge.textContent = '×' + handlers.length;
    typeRow.appendChild(badge);

    var handlerList = document.createElement('div');
    handlers.forEach(function (h) {
      var hRow = document.createElement('div');
      hRow.className = 'event-handler-row';

      var arrow = document.createElement('span');
      arrow.className = 'handler-arrow';
      arrow.textContent = '↳';
      hRow.appendChild(arrow);

      var name = document.createElement('span');
      name.className = 'handler-name';
      name.textContent = h.name;
      name.title = h.name;
      hRow.appendChild(name);

      if (h.capture) { var f = document.createElement('span'); f.className = 'handler-flag capture'; f.textContent = 'capture'; hRow.appendChild(f); }
      if (h.passive) { var f2 = document.createElement('span'); f2.className = 'handler-flag passive'; f2.textContent = 'passive'; hRow.appendChild(f2); }
      if (h.once)    { var f3 = document.createElement('span'); f3.className = 'handler-flag once';    f3.textContent = 'once';    hRow.appendChild(f3); }

      handlerList.appendChild(hRow);
    });

    typeRow.addEventListener('click', function () {
      var open = handlerList.style.display !== 'none';
      handlerList.style.display = open ? 'none' : '';
      chevron.classList.toggle('open', !open);
    });

    eventsList.appendChild(typeRow);
    eventsList.appendChild(handlerList);
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   STYLES
───────────────────────────────────────────────────────────────────────────── */
function makeStyleRow(prop, val) {
  var row = document.createElement('div');
  row.className = 'style-row';

  var propEl = document.createElement('span');
  propEl.className = 'style-prop';
  propEl.textContent = prop + ':';
  row.appendChild(propEl);

  var valEl = document.createElement('span');
  valEl.className = 'style-val';

  var colorMatch = val.match(/^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))$/i);
  if (colorMatch) {
    var swatch = document.createElement('span');
    swatch.className = 'color-swatch';
    swatch.style.background = val;
    valEl.appendChild(swatch);
  }
  valEl.appendChild(document.createTextNode(val));
  row.appendChild(valEl);
  return row;
}

function renderStyles(styles) {
  stylesContent.innerHTML = '';
  if (!styles) return;

  var inlineHdr = document.createElement('div');
  inlineHdr.className = 'styles-sub-hdr';
  inlineHdr.textContent = 'Inline';
  stylesContent.appendChild(inlineHdr);

  if (styles.inline && styles.inline.trim()) {
    styles.inline.split(';').forEach(function (decl) {
      decl = decl.trim();
      if (!decl) return;
      var colon = decl.indexOf(':');
      if (colon < 0) return;
      var p = decl.slice(0, colon).trim(), v = decl.slice(colon + 1).trim();
      if (p && v) stylesContent.appendChild(makeStyleRow(p, v));
    });
  } else {
    var noInline = document.createElement('div');
    noInline.className = 'no-inline-note';
    noInline.textContent = 'No inline styles';
    stylesContent.appendChild(noInline);
  }

  var divider = document.createElement('div');
  divider.className = 'styles-divider';
  stylesContent.appendChild(divider);

  var computedHdr = document.createElement('div');
  computedHdr.className = 'styles-sub-hdr';
  computedHdr.textContent = 'Computed';
  stylesContent.appendChild(computedHdr);

  var order = [
    'display','visibility','opacity','pointer-events','cursor',
    'position','z-index','top','left','right','bottom',
    'width','height','overflow','overflow-x','overflow-y',
    'flex','flex-direction','align-items','justify-content',
    'padding','margin',
    'color','background-color','border','border-radius',
    'font-size','font-weight','font-family',
    'transform','transition','box-shadow'
  ];
  order.forEach(function (prop) {
    var val = styles.computed[prop];
    if (val) stylesContent.appendChild(makeStyleRow(prop, val));
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN RENDER
───────────────────────────────────────────────────────────────────────────── */
function renderResults(data) {
  renderElemBar(data.elementInfo);
  renderRankedList(data.locators);
  renderEventListeners(data.events);
  renderStyles(data.styles);
  showResults();
}

/* ─────────────────────────────────────────────────────────────────────────────
   ANALYSIS
───────────────────────────────────────────────────────────────────────────── */
function analyzeElement() {
  showLoading();
  chrome.devtools.inspectedWindow.eval(
    LOCATOR_ENGINE,
    function (result, exceptionInfo) {
      if (exceptionInfo) {
        showStatus('Error: ' + (exceptionInfo.description || exceptionInfo.value || 'Unknown'));
        return;
      }
      if (result === null || result === undefined) {
        showStatus('Select an element in the Elements panel');
        return;
      }
      var data;
      try { data = JSON.parse(result); }
      catch (e) { showStatus('Parse error: ' + e.message); return; }
      if (data.error) { showStatus(data.error); return; }
      renderResults(data);
    }
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   BOOTSTRAP
───────────────────────────────────────────────────────────────────────────── */
chrome.devtools.panels.elements.onSelectionChanged.addListener(analyzeElement);
document.getElementById('refresh-btn').addEventListener('click', analyzeElement);

window.locatorHubRefresh = analyzeElement;

analyzeElement();

