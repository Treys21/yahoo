# 2026-27 NBA Roto Values

`2026-27-NBA-Roto-Values.xlsx` is the basketball counterpart to the NHL
projections workbook. It values FantasyPros' 2026-27 consensus projections
under Yahoo's public prize roto defaults and compares them with Yahoo ADP.

| Setting | Yahoo default |
| --- | --- |
| Teams | 12 |
| Categories | PTS REB AST STL BLK 3PM FG% FT% TO |
| Roster | PG SG G SF PF F C C Util Util · BN 3 · IL 3 |
| Games | 82 max per roster slot, daily lineups |

## Sheets

| Sheet | What it holds |
| --- | --- |
| The List | RK, VALUE, VORP, Yahoo ADP, DIFF, GP, MPG, projected totals and per-category z-scores. Type `+ + +` … `- - -` in ADJ to boost or bust a player. |
| Minutes & Health | Projected vs 2025-26 minutes (MPG Δ green/red at ±3), ESPN injury status and return date, games out, and **Your GP / Your MPG** overrides. |
| Settings | Category weights (0 = punt), teams, roster slots, GP mode, boost table. Yellow cells are inputs. |
| Player Data | Source projections, estimated FGA / FTA, ADP. |
| Pool | Means and stdevs each z-score is measured against. |
| Schedule | Every 2026-27 game date per team (Basketball-Reference). |

The helper columns at the right of The List are grouped and collapsed.

## How value is calculated

0. Minutes & Health: games = Your GP, else projected GP capped at
   82 − Games Out (his team's games before ESPN's return date); minutes =
   Your MPG, else projected MPG. Edit Return to move an injury.
1. Projected totals = per-minute rate × MPG × games × boost. Games = Flat GP
   instead with *Games Played Projection* = No.
2. FG% and FT% are weighted by volume: impact = FGA × (FG% − pool FG%).
3. Pass 1 z-scores everyone against all 265 players. The top
   teams × 13 (156) form the value pool.
4. Pass 2 z-scores everyone against that pool. TO counts against you.
   VALUE = Σ weight × z.
5. VORP = VALUE − the 157th-best VALUE (the best player left after the draft).
   DIFF = Yahoo ADP − RK: positive means the market drafts him later than his value.

**Attempts are estimated.** FantasyPros projections have FG% / FT% but not
attempts. The sheet solves PTS = 2·FGM + 3PM + FTM, using each player's
2025-26 FTA/FGA (shrunk toward his position's median by 200 FGA). Rookies and
players who missed 2025-26 use the position median. Those are marked in Player
Data's *FTr source* column.

## Rebuild

```
python3 -m venv .venv && .venv/bin/pip install openpyxl==3.1.5
python3 nba/sources.py --refresh     # optional: re-download projections, ADP, 2025-26 stats,
                                     # the schedule and ESPN's injury report
.venv/bin/python nba/build.py        # writes the workbook (formulas only)
```

`build.py` writes formulas without cached values. Open the file in Excel and save
it once so that previews and other readers see the numbers.

`nba/verify.py <copy.xlsx>` checks a copy that Excel has recalculated against the Python
model in `build.py`. It matched all 265 players under the default settings,
10 teams, flat 70 GP, a FT% punt with half-weight TO, boosts, Your MPG / Your
GP overrides, and moved return dates.

## Draft-room extension

The repo's Chrome extension (manifest at the root) also runs in Yahoo's NBA
draft room, mock drafts included (`basketball.fantasysports.yahoo.com/draftclient/nba/…`).
It loads this workbook (bundled, or your own via popup → **NBA board →** →
Import .xlsx) and, after every pick:

- **Gain**: expected roto standings points the player adds to *your* team.
  Every team's category totals (drafted players + average picks for open spots)
  become expected points via P(beat each other team); gain is the change.
- **Starts**: the season is played night by night on the real schedule:
  healthy players whose team plays are slotted into PG SG G SF PF F C C Util
  Util (most specific slot first), best per-game player first, with Yahoo's
  82-game cap per slot. Nights a player sits come off his value, so a
  fourth C-only center or a fourth player from a crowded position gains less.
- **Back**: chance he lasts to your following pick, from Yahoo ADP.
- The pick order (#) is gain, nudged toward players who won't come back;
  picks that would leave a starting slot unfillable are skipped (⊘).
- **Sync Yahoo queue** (off by default, and per draft — it starts off in every new draft room) replaces your Yahoo draft queue with
  the top 10 after every pick, so Yahoo's autopick follows the board. It sends
  only the queue message Yahoo's own client sends.
- GP shows INJ/DTD tags (hover for ESPN's note); MPG shows ▲/▼ for 3+ minute
  role changes vs 2025-26.

Tests: `npm test` (the JS model is checked against the same Excel recalculations).

## Offline rankings viewer

```
npm run viewer        # exports the workbook, then serves http://localhost:8765/nba/viewer/
```

The same board as the draft room, with no Yahoo and no extension. Sort and
filter, punt categories in ⚙ Settings, and mark players **taken** or **mine**
to practice a draft: Gain, Starts and the outlook follow your roster. Marks
and settings are kept in the browser. After editing the workbook, save it in
Excel and run `npm run viewer` again. `npm run viewer:export` only rewrites
`nba/viewer/data.js`; `nba/viewer/index.html` also opens straight from disk.
