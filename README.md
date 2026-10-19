# Yahoo NHL Draft Board Overlay

> Also runs in Yahoo's NBA draft room with live roto recommendations — see [nba/README.md](nba/README.md).

A Chrome extension that puts the rankings from your projections spreadsheet
(`2026-27-Fantasy-Projections-Yahoo-3.xlsx`) inside Yahoo's live Fantasy Hockey
draft room: a floating big board that drops players the moment they're
drafted, plus your rank as a badge on Yahoo's own player list.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder

## Use

1. Click the extension icon → **Import .xlsx** (opens in a tab — Chrome closes
   popups when a file dialog opens) → pick your saved workbook.
2. Open your draft room (`hockey.fantasysports.yahoo.com/draftclient/hockey/<league>/<team>`)
   or a mock draft. The board appears on the left; drag it anywhere.

Changed something in the **Settings** sheet? Save in Excel and re-import —
open draft rooms update without a reload. The extension reads the values Excel
saved, so the workbook must be saved after recalculating.

## The board

| Column | Meaning |
| --- | --- |
| Rk | Rank by VORP under the current settings (matches *The List* RK) |
| Pos | Yahoo's eligibility (falls back to the sheet's POS) |
| PRk | Positional rank from the sheet |
| VORP / ADP | From the sheet |
| Diff | ADP − Rk, coloured with the sheet's steal / reach tiers |
| Adj | Your boost/bust marks (`+ + +` … `- - -`) |
| ✕ | Mark a player drafted by hand (↺ undoes). Stored per draft. |

- Position chips: ALL · C · LW · RW · F (any forward) · D · G. Multi-position
  players show under every position they're eligible for.
- **Hide drafted** is on by default; turn it off to see who went where (#pick).
- Click a column header to sort; VORP / Diff / Adj start descending.
- Hover a name for projected stats; click it to type the name into Yahoo's search.
- Top strip: best available C / LW / RW / D / G. Below it, your roster fill
  against the starters in Settings (C2 LW2 RW2 D4 G2).
- Banner when you're on the clock, and a heads-up 3 picks out.

## Live settings (⚙)

The ⚙ button opens the same valuation controls as the workbook's **Settings**
sheet. Flip one and the board re-ranks instantly: RK, VORP, positional rank,
Diff and the projected stats in each tooltip all update.

| Control | Settings cell |
| --- | --- |
| Projected GP On / Off | E12 Games Played Projection (Off = flat 84 GP for skaters, as in the sheet) |
| Replacement Blend / Position / Draft | E21 Replacement Level |
| Boost / bust On / Off | E27 Boost or Bust |
| Forwards C/LW/RW / All F | E18 Forward Separation |
| Scoring Categories / Points | E15 League Type |
| Teams | E24 Number of Teams |

The underlined choice is what your sheet says; "Reset to sheet" puts them back.
Defaults come from the imported workbook (currently Categories · 12 teams ·
Blend · GP on · C2 LW2 RW2 D4 G2 · Yahoo ADP).

`src/lib/valuation.js` re-implements the workbook's chain (Player Data rates ×
games × boost → z-scores or points → position-sheet replacement player →
VORP → RK). It was checked against Excel itself: a copy of the workbook was
recalculated in Excel under ten setting combinations, and every player's RK,
VORP and positional rank matches (`test/valuation.test.js`).

Note: in the workbook, **Boost or Bust ON/OFF (E27) isn't referenced by any
formula**, so boosts are always applied there. The overlay's switch does turn
them off.

## Markers

The Settings colour legend is read from the font colours in *The List*:

| Tag | Meaning |
| --- | --- |
| team in blue / red | weak / strong defensive SOS |
| **BRK** / **AGE** | pre-prime breakout / post-prime decline |
| **CY** | contract year |
| **TOI▲** / **TOI▼** | role increase / decrease (>1 min) |
| **PP1** (bright / faded) | PP1 >60% / 50–60% of TOI |

Diff uses the sheet's DIFF. tiers: +24 steal, +10 potential steal, −10
potential reach, −24 reach. Adj shows your boost / bust marks.

## How picks are detected

Yahoo's draft client receives every event over a websocket — there is no
pickable JSON endpoint to poll. `src/yahoo/ws-hook.js` runs in the page at
`document_start`, wraps the `WebSocket` constructor, and forwards text frames
to the content script. It only listens; nothing is sent or changed.

The frame format comes from the message table in Yahoo's
`react-draft-client` bundle (decoded in `src/lib/draft-protocol.js`):

```
0|pickId|playerId|teamId|pos|cost   PICK_MADE
P|1=playerId,teamId,cost|2=...      PICK_LIST_CHANGED  (full history on connect)
u|pickId|teamId|playerId            PICK_UNDONE
K|pickId=playerId|...               KEEPER_LIST_CHANGED
D|pickId|teamId|countdown           CURRENT_PICK_CHANGED
R|teamId|...                        DRAFT_ORDER_CHANGED
```

Because the server replays the pick list whenever the client connects,
opening or reloading the draft room mid-draft still shows the right board.

Picks carry Yahoo player ids. Those resolve through the same public player
pool the draft client loads (`pub-api.fantasysports.yahoo.com/fantasy/v3/players/nhl/<league>`),
which gives full names — the draft room itself only shows "C. McDavid".
All 670 players in the current sheet link to a Yahoo id.

## Layout

```
manifest.json
src/lib/xlsx-reader.js      dependency-free .xlsx reader (zip + DecompressionStream)
src/lib/workbook-import.js  The List / Settings → player records
src/lib/valuation.js        the workbook's VORP / rank model, for live settings
src/lib/match-names.js      sheet ↔ Yahoo name/team matching
src/lib/draft-protocol.js   websocket frame decoder, snake-order math
src/lib/yahoo-api.js        draft route, Yahoo player pool, ranking ↔ Yahoo id links
src/lib/storage.js, dom.js  chrome.storage wrappers, CSP-safe styles
src/yahoo/ws-hook.js        page-world websocket listener
src/yahoo/panel.js          the board (shadow DOM)
src/yahoo/inline-badges.js  rank badges on Yahoo's list — every Yahoo selector lives here
src/yahoo/content.js        orchestrator
src/popup/                  import + preview
test/                       node --test (no dependencies)
```

## Tests

```
npm test
```

Covers the workbook import (against a copy of the real workbook), the
valuation model (against Excel's own recalculations), name
matching (against Yahoo's real 1,596-player pool), and the frame decoder
(against frames captured from a live mock draft).
