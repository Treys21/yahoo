// Runs in the PAGE's world at document_start, before Yahoo's draft client.
//
// The draft client gets every pick over a websocket (there is no pollable pick
// endpoint), so we wrap the WebSocket constructor and copy each relevant text
// frame to the extension's content script via window.postMessage.
//
// Frames are also kept in a buffer: the server sends the full pick history
// (a "P|..." frame) right after connecting, and the content script asks for a
// replay on startup so it never misses that, whichever script loads first.
//
// The one thing this ever sends is your draft queue, and only when the
// content script asks ({ __ydr: 'set-queue', ids }). It goes out exactly as
// Yahoo's own client sends it — "S|leagueId|managerId|id|id|..." — on the
// socket that joined the draft. The league and manager ids come from the
// client's own join frame ("8|leagueId|managerId|..."); its auth token is
// never read or forwarded.
(function () {
  'use strict';

  if (window.__ydrWsHooked) return;
  window.__ydrWsHooked = true;

  const RELEVANT = /^(0|P|u|K|D|R|Q|r|Y)(\||$)/;
  const MAX_BUFFER = 2000;
  const MAX_QUEUE = 50;
  const frames = [];
  const Native = window.WebSocket;
  let draftSocket = null;
  let identity = null; // { leagueId, managerId }

  function forward(data) {
    if (typeof data !== 'string' || !RELEVANT.test(data)) return;
    if (frames.length < MAX_BUFFER) frames.push(data);
    window.postMessage({ __ydr: 'frame', data }, location.origin);
  }

  function announce() {
    window.postMessage({ __ydr: 'identity', identity }, location.origin);
  }

  class HookedWebSocket extends Native {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        try {
          forward(event.data);
        } catch {
          // never interfere with the draft client
        }
      });
    }

    send(data) {
      try {
        // Join: "8|leagueId|managerId|userAgent|auth" ("9" for spectators, who can't queue).
        const join = typeof data === 'string' && data.match(/^8\|(\d+)\|(\d+)\|/);
        if (join) {
          draftSocket = this;
          identity = { leagueId: join[1], managerId: join[2] };
          announce();
        }
      } catch {
        // never interfere with the draft client
      }
      return super.send(data);
    }
  }
  window.WebSocket = HookedWebSocket;

  function setQueue(ids) {
    if (!draftSocket || !identity || draftSocket.readyState !== Native.OPEN) return false;
    if (!Array.isArray(ids) || ids.length > MAX_QUEUE) return false;
    if (!ids.every((id) => Number.isInteger(id) && id > 0)) return false;
    draftSocket.send(['S', identity.leagueId, identity.managerId, ...ids].join('|'));
    return true;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    const msg = event.data;
    if (msg.__ydr === 'replay-request') {
      window.postMessage({ __ydr: 'replay', frames: frames.slice() }, location.origin);
      if (identity) announce();
    } else if (msg.__ydr === 'set-queue') {
      const ok = setQueue(msg.ids);
      window.postMessage({ __ydr: 'set-queue-result', ok }, location.origin);
    }
  });
})();
