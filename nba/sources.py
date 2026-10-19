"""Parse the saved source pages in nba/data/ into plain player records.

  fantasypros-projections.html  2026-27 consensus season projections (totals)
  fantasypros-adp.html          Yahoo / ESPN ADP
  bbref-2025-26-totals.html     last season's totals: shot-attempt rates and minutes per game
  bbref-2026-27-<month>.html    the 2026-27 schedule (October–April)
  espn-injuries.json            ESPN's current injury report, with estimated return dates

`python3 nba/sources.py --refresh` re-downloads all three.
"""
import datetime
import html
import json
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

DATA = Path(__file__).parent / 'data'
MONTHS = ['october', 'november', 'december', 'january', 'february', 'march', 'april']
URLS = {
    'fantasypros-projections.html': 'https://www.fantasypros.com/nba/projections/overall.php',
    'fantasypros-adp.html': 'https://www.fantasypros.com/nba/adp/overall.php',
    'bbref-2025-26-totals.html': 'https://www.basketball-reference.com/leagues/NBA_2026_totals.html',
    'espn-injuries.json': 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries',
    **{f'bbref-2026-27-{m}.html': f'https://www.basketball-reference.com/leagues/NBA_2027_games-{m}.html' for m in MONTHS},
}
# Basketball-Reference team codes -> the FantasyPros codes the projections use.
BBREF_TEAMS = {'BRK': 'BKN', 'CHO': 'CHA', 'NOP': 'NOR', 'UTA': 'UTH'}
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

PROJ_COLS = ['pts', 'reb', 'ast', 'blk', 'stl', 'fgPct', 'ftPct', 'tpm', 'gp', 'min', 'to']


def refresh():
    for name, url in URLS.items():
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=30) as resp:
            (DATA / name).write_bytes(resp.read())
        print('saved', name)
        time.sleep(3)  # Basketball-Reference rate-limits bursts


def key(name):
    """Name key that survives accents, punctuation and Jr./III suffixes."""
    s = unicodedata.normalize('NFKD', html.unescape(name)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[^a-z ]', '', s.replace('-', ' '))
    s = re.sub(r'\b(jr|sr|ii|iii|iv|v)\b', '', s)
    return ' '.join(s.split())


def num(text):
    text = re.sub(r'<[^>]+>', '', text).replace(',', '').strip()
    try:
        return float(text)
    except ValueError:
        return None


def label(cell):
    """'<a ...>Name</a> <small>(TEAM - PG,SG)</small>' -> (name, team, [positions])."""
    name = html.unescape(re.search(r'fp-player-name="([^"]+)"', cell).group(1))
    small = re.search(r'<small>\(([^)]*)\)</small>', cell)
    team, pos = (small.group(1).split(' - ') + [''])[:2] if small else ('', '')
    return name, team.strip(), [p for p in pos.split(',') if p]


def projections():
    page = (DATA / 'fantasypros-projections.html').read_text()
    players = []
    for row in re.findall(r'<tr class="mpb-player-\d+">(.*?)</tr>', page, re.S):
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
        name, team, pos = label(cells[0])
        stats = dict(zip(PROJ_COLS, (num(c) for c in cells[1:])))
        players.append({'name': name, 'team': team, 'pos': pos, **stats})
    return players


def adp():
    page = (DATA / 'fantasypros-adp.html').read_text()
    body = page[page.find('<tbody'):page.find('</tbody>')]
    out = {}
    for row in re.split(r'<tr\b[^>]*>', body)[1:]:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
        if len(cells) < 5 or 'fp-player-name' not in cells[1]:
            continue
        name, _, _ = label(cells[1])
        out[key(name)] = {'yahoo': num(cells[2]), 'espn': num(cells[3]), 'avg': num(cells[4])}
    return out


def last_season():
    """bbref totals -> {key: {gp, min, fga, fta, ...}}. Traded players list a
    combined row (2TM/3TM) first, so the first row per player wins."""
    page = (DATA / 'bbref-2025-26-totals.html').read_text()
    out = {}
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
        cells = dict(re.findall(r'data-stat="([a-z_0-9]+)"[^>]*>(.*?)</t[dh]>', row, re.S))
        if 'name_display' not in cells or 'fta' not in cells:
            continue
        k = key(re.sub(r'<[^>]+>', '', cells['name_display']))
        if k in out or not k:
            continue
        out[k] = {f: num(cells.get(s, '')) or 0.0 for f, s in
                  [('gp', 'games'), ('min', 'mp'), ('fgm', 'fg'), ('fga', 'fga'),
                   ('ftm', 'ft'), ('fta', 'fta'), ('tpm', 'fg3'), ('pts', 'pts')]}
    return out


def schedule():
    """[(date, team), ...] for every 2026-27 regular-season game, both teams, in FantasyPros codes.
    Also returns {full team name: code}."""
    games, names = [], {}
    for m in MONTHS:
        page = (DATA / f'bbref-2026-27-{m}.html').read_text()
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', page, re.S):
            cells = dict(re.findall(r'data-stat="([a-z_]+)"[^>]*>(.*?)</t[dh]>', row, re.S))
            if 'visitor_team_name' not in cells or '/teams/' not in cells['visitor_team_name']:
                continue  # header rows
            day = datetime.datetime.strptime(re.sub(r'<[^>]+>', '', cells['date_game']), '%a, %b %d, %Y').date()
            for side in ('visitor_team_name', 'home_team_name'):
                code = re.search(r'/teams/([A-Z]{3})/', cells[side]).group(1)
                code = BBREF_TEAMS.get(code, code)
                names[re.sub(r'<[^>]+>', '', cells[side])] = code
                games.append((day, code))
    return sorted(games), names


def injuries(team_names):
    """ESPN injury report -> {key: {status, returnDate, team, comment}}."""
    data = json.loads((DATA / 'espn-injuries.json').read_text())
    out = {}
    for team in data['injuries']:
        code = team_names.get(team['displayName'], '')
        for item in team['injuries']:
            ret = (item.get('details') or {}).get('returnDate')
            out[key(item['athlete']['displayName'])] = {
                'status': item['status'],
                'returnDate': datetime.date.fromisoformat(ret) if ret else None,
                'team': code,
                'comment': item.get('shortComment', ''),
                'updated': item.get('date', '')[:10],
            }
    return out


if __name__ == '__main__':
    if '--refresh' in sys.argv:
        refresh()
    p, a, l = projections(), adp(), last_season()
    print(len(p), 'projected,', len(a), 'with ADP,', len(l), 'last-season rows')
    print('no ADP:', [x['name'] for x in p if key(x['name']) not in a][:40])
    print('no 2025-26 stats:', [x['name'] for x in p if key(x['name']) not in l])
