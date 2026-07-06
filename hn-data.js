/*
 * hn-data.js — Sdílený loader dat pro HranaNetu.cz TCG Klub
 * ------------------------------------------------------------
 * JEDINÉ místo v celém webu, kde je hardcoded ID Master Google Sheetu
 * a kanonický seznam lig. Všechny stránky (uvod, ligy, ceny, kalendar,
 * liga-detail, pravidla) načtou tento soubor a zavolají HN.load(),
 * které VŽDY stáhne aktuální data přímo z Master Sheetu - nezávisle
 * na tom, jestli uživatel předtím navštívil nějakou jinou stránku,
 * a nezávisle na zařízení/prohlížeči. localStorage se používá jen
 * jako okamžitá "zálohovaná" hodnota pro první vykreslení, vždy se
 * ale přepíše čerstvými daty.
 *
 * Struktura Master Sheetu (google sheet, karty/tabs):
 *   Ligy    - Liga | ... | Sheet ID | ...           (sloupec 0=id ligy, 2=ID tabulky se standingy)
 *   Ceny    - Liga | Formát | 1.-4.místo | 5-8.místo
 *   Kalendar- klíč "API Key" / "Calendar ID" a jejich hodnoty
 *   Sezony  - Sezóna | Začátek | Konec
 *   Pravidla- Nadpis | Text                          (VOLITELNÁ záložka, viz tcg-pravidla.html)
 */
window.HN = (function () {
  const MASTER_SHEET_ID = '1GVu0smMspWVPOz1t7qY2tOuifdZRZ5Z6UvUN6x-mvAI';

  // ── Kanonický seznam lig — JEDINÝ zdroj pravdy pro id/kód/název/barvu ──
  const LEAGUES = [
    { id: 'fab',   code: 'FAB',       name: 'Flesh and Blood', color: '#4ade80' },
    { id: 'gd',    code: 'GUNDAM',    name: 'Gundam',          color: '#fcd34d' },
    { id: 'mtgd',  code: 'MTG',       name: 'MTG Draft',       color: '#b39ddb' },
    { id: 'mtgm',  code: 'MTG',       name: 'MTG Modern',      color: '#9b4dff' },
    { id: 'mtgpa', code: 'MTG',       name: 'MTG Pauper',      color: '#a78bfa' },
    { id: 'mtgp',  code: 'MTG',       name: 'MTG Premodern',   color: '#c51df5' },
    { id: 'op',    code: 'ONE PIECE', name: 'One Piece',       color: '#f87171' },
    { id: 'pk',    code: 'POKÉMON',   name: 'Pokémon',         color: '#ffcb05' },
    { id: 'rb',    code: 'RIFTBOUND', name: 'Riftbound',       color: '#7fb3f5' },
    { id: 'so',    code: 'SORCERY',   name: 'Sorcery',         color: '#c084fc' },
    { id: 'ygo',   code: 'YGO',       name: 'Yu-Gi-Oh!',       color: '#fb923c' },
  ];

  // Mapování názvu ligy (jak je napsaná v Master Sheetu) → interní id
  const LEAGUE_NAME_MAP = {};
  LEAGUES.forEach(l => { LEAGUE_NAME_MAP[l.name.toLowerCase()] = l.id; });
  Object.assign(LEAGUE_NAME_MAP, {
    'flesh & blood': 'fab',
    'pokemon': 'pk',
    'yu-gi-oh': 'ygo', 'yugioh': 'ygo',
  });

  function parseCSV(text) {
    const rows = [];
    for (const line of text.trim().split('\n')) {
      if (!line.trim()) continue;
      const cells = []; let cur = '', inQ = false;
      for (const c of line) {
        if (c === '"') { inQ = !inQ; }
        else if (c === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      cells.push(cur.trim());
      rows.push(cells);
    }
    return rows;
  }

  // Stáhne jednu záložku Master Sheetu jako CSV řádky. `_` cache-buster
  // zajišťuje, že se nepoužije stará odpověď z prohlížečové cache.
  async function fetchTab(tabName) {
    const url = `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&_=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Nelze načíst list "' + tabName + '"');
    const text = await res.text();
    if (text.includes('google.visualization') || text.trim().startsWith('/*')) {
      throw new Error('List "' + tabName + '" nenalezen v Master Sheetu');
    }
    return parseCSV(text);
  }

  function parseCzechDate(str) {
    const m = (str || '').trim().match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
    if (!m) return null;
    return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
  }

  function determineActiveSeason(seasonRows) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const row of seasonRows) {
      const start = parseCzechDate(row[1]);
      const end = parseCzechDate(row[2]);
      if (start && end && today >= start && today <= end) return row[0];
    }
    const future = seasonRows
      .map(r => ({ name: r[0], start: parseCzechDate(r[1]) }))
      .filter(r => r.start && r.start > today)
      .sort((a, b) => a.start - b.start);
    if (future.length) return future[0].name;
    return seasonRows.length ? seasonRows[seasonRows.length - 1][0] : null;
  }

  function buildPlaces(r) {
    const p1 = (r[2] || '').trim(), p2 = (r[3] || '').trim(), p3 = (r[4] || '').trim(), p4 = (r[5] || '').trim();
    const p58 = (r[6] || '').trim();
    return [p1, p2, p3, p4, p58, p58, p58, p58];
  }

  function applyPrizeRow(target, format, places) {
    const fmt = (format || '').toUpperCase().trim();
    if (fmt.includes('ŽEBŘÍČEK') || fmt === 'ZEBRICEK') target.zeb = places.slice(0, 3);
    else if (fmt.includes('TOP4') || fmt.includes('TOP 4')) target.top4 = places.slice(0, 4);
    else if (fmt.includes('TOP8') || fmt.includes('TOP 8')) target.top8 = places.slice(0, 8);
  }

  let _loadPromise = null;

  // Hlavní loader. VŽDY stáhne živá data z Master Sheetu bez ohledu na to,
  // z jaké stránky uživatel přišel. Volá se na začátku každé stránky.
  function load() {
    if (_loadPromise) return _loadPromise; // jedno stažení stačí na jedno načtení stránky
    _loadPromise = (async () => {
      const data = {
        activeSeason: null,
        leagues: {},     // { [ligaId]: {sheetId, tab} }
        prizes: {},      // { [ligaId]: {zeb, top4, top8} }
        calendar: { apiKey: '', calId: '' },
        rules: [],       // [{heading, text}] - z volitelné záložky "Pravidla"
        ok: false,
      };
      try {
        const [ligyRows, cenyRows, kalRows, sezRows] = await Promise.all([
          fetchTab('Ligy'), fetchTab('Ceny'), fetchTab('Kalendar'), fetchTab('Sezony'),
        ]);

        // Sezóny → aktivní sezóna
        const seasonData = sezRows.slice(1).filter(r => r[0]);
        data.activeSeason = determineActiveSeason(seasonData) || 'Léto 2026';
        localStorage.setItem('hn_cfg', JSON.stringify({ season: data.activeSeason }));

        // Kalendář API (Google Calendar credentials, NE samotné turnaje)
        const kal = {};
        kalRows.slice(1).forEach(r => { if (r[0]) kal[r[0].trim()] = (r[1] || '').trim(); });
        data.calendar = { apiKey: kal['API Key'] || '', calId: kal['Calendar ID'] || '' };
        if (data.calendar.apiKey || data.calendar.calId) {
          localStorage.setItem('hrananetu_cfg', JSON.stringify(data.calendar));
        }

        // Ligy → Sheet ID s výsledky pro každou ligu
        ligyRows.slice(1).forEach(r => {
          const id = (r[0] || '').trim();
          const sid = (r[2] || '').trim();
          if (id && sid) {
            data.leagues[id] = { sheetId: sid, tab: data.activeSeason };
            localStorage.setItem('hn_' + id, JSON.stringify(data.leagues[id]));
          }
        });

        // Ceny (nejdřív "Všechny" jako fallback, pak konkrétní ligy přepíší)
        const prizes = {};
        const ensureLeague = (id) => { if (!prizes[id]) prizes[id] = { zeb: [], top4: [], top8: [] }; return prizes[id]; };
        const allLeagueIds = LEAGUES.map(l => l.id);
        cenyRows.slice(1).forEach(r => {
          const ligaName = (r[0] || '').trim();
          if (ligaName.toLowerCase() === 'všechny') {
            const places = buildPlaces(r);
            allLeagueIds.forEach(id => applyPrizeRow(ensureLeague(id), r[1], places));
          }
        });
        cenyRows.slice(1).forEach(r => {
          const ligaName = (r[0] || '').trim();
          if (ligaName.toLowerCase() === 'všechny') return;
          const id = LEAGUE_NAME_MAP[ligaName.toLowerCase()];
          if (id) applyPrizeRow(ensureLeague(id), r[1], buildPlaces(r));
        });
        data.prizes = prizes;
        localStorage.setItem('hn_prizes', JSON.stringify(prizes));

        // Pravidla — VOLITELNÁ záložka. Pokud v Master Sheetu neexistuje,
        // tcg-pravidla.html použije svůj statický text jako fallback.
        try {
          const pravRows = await fetchTab('Pravidla');
          data.rules = pravRows.slice(1)
            .filter(r => r[0] || r[1])
            .map(r => ({ heading: (r[0] || '').trim(), text: (r[1] || '').trim() }));
          localStorage.setItem('hn_rules', JSON.stringify(data.rules));
        } catch (e) {
          // Záložka "Pravidla" zatím v sheetu není — v pořádku, není to chyba.
        }

        data.ok = true;
      } catch (err) {
        console.warn('HN: Master Sheet se nepodařilo načíst, stránka použije poslední lokálně uložená data.', err.message);
      }
      return data;
    })();
    return _loadPromise;
  }

  return { MASTER_SHEET_ID, LEAGUES, LEAGUE_NAME_MAP, parseCSV, fetchTab, load };
})();
