// Best-effort rank badges on Yahoo's own player list.
//
// Yahoo's class names are hashed and change between deploys; the stable hooks
// are `.ys-player[data-id]` (the Yahoo player id) and
// `data-i13n-module="player-list"`, which only the main Players table carries.
// Every guess at Yahoo's markup lives here. If nothing matches, the module
// does nothing and the panel carries on.
globalThis.YDR = globalThis.YDR || {};

(function (YDR) {
  'use strict';

  const BADGE_CLASS = 'ydr-rank-badge';
  const ROW_SELECTOR = '.ys-player[data-id][data-i13n-module="player-list"]';

  let rowByYahooId = new Map();
  let observer = null;
  let styleInjected = false;

  function injectStyle() {
    if (styleInjected) return;
    YDR.dom.applyStyles(document, `
      .${BADGE_CLASS} {
        display: inline-block; flex: none; margin-right: 5px; padding: 0 5px; min-width: 22px;
        border-radius: 4px; background: #7e1fff; color: #fff; text-align: center;
        font: 700 10px/16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        vertical-align: middle;
      }
      .${BADGE_CLASS}[data-tier="steal"] { background: #146c43; }
    `);
    styleInjected = true;
  }

  /** @param rows board rows carrying yahooId */
  function update(rows) {
    rowByYahooId = new Map();
    for (const row of rows) if (row.yahooId) rowByYahooId.set(String(row.yahooId), row);
    injectStyle();
    decorate();
    startObserving();
  }

  // The player name is the first leaf element with text, e.g. "C. McDavid".
  function nameElement(playerEl) {
    const walker = document.createTreeWalker(playerEl, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node.children.length === 0 && /[A-Za-z]\.\s*\S/.test(node.textContent || '')) return node;
      node = walker.nextNode();
    }
    return null;
  }

  function decorate() {
    for (const playerEl of document.querySelectorAll(ROW_SELECTOR)) {
      const row = rowByYahooId.get(playerEl.getAttribute('data-id'));
      let badge = playerEl.querySelector(`.${BADGE_CLASS}`);

      if (!row) {
        badge?.remove();
        continue;
      }
      if (!badge) {
        const name = nameElement(playerEl);
        if (!name) continue;
        badge = document.createElement('span');
        badge.className = BADGE_CLASS;
        // Inside the name element, not beside it: when React recycles the row
        // it rewrites the name's text, which wipes a stale badge for free.
        name.prepend(badge);
      }
      // Yahoo recycles row elements as the list scrolls, so always refresh.
      const text = String(row.rank);
      if (badge.textContent !== text) badge.textContent = text;
      badge.dataset.tier = row.diff !== null && row.diff >= 12 ? 'steal' : '';
      badge.title = `My rank ${row.rank} · VORP ${row.vorp ?? '-'} · ADP ${row.adp ?? '-'}`;
    }
  }

  function startObserving() {
    if (observer || !document.body) return;
    let pending = false;
    observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        try {
          decorate();
        } catch {
          // never let badge failures surface — the panel is what matters
        }
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  YDR.badges = { update };
})(globalThis.YDR);
