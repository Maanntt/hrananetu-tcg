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
    { id: 'cp',    code: 'CYBERPUNK', name: 'Cyberpunk',       color: '#ef4444' },
  ];

  // Mapování názvu ligy (jak je napsaná v Master Sheetu) → interní id
  const LEAGUE_NAME_MAP = {};
  LEAGUES.forEach(l => { LEAGUE_NAME_MAP[l.name.toLowerCase()] = l.id; });
  Object.assign(LEAGUE_NAME_MAP, {
    'flesh & blood': 'fab',
    'pokemon': 'pk',
    'yu-gi-oh': 'ygo', 'yugioh': 'ygo',
    'cyberpunk red': 'cp', 'cyberpunk 2077': 'cp',
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

  // ── Pravidlo "nejlepších X výsledků" ──
  // 1-4 turnaje  → počítají se všechny (žádné škrtání)
  // 5-6 turnajů  → počítají se 4 nejlepší výsledky
  // 7-8 turnajů  → počítá se 6 nejlepších výsledků
  // 9 a více     → počítá se 8 nejlepších výsledků
  // totalRounds = celkový počet ligových turnajů naplánovaných v sezóně (ne jen odehraných).
  function bestOfThreshold(totalRounds) {
    if (totalRounds >= 9) return 8;
    if (totalRounds >= 7) return 6;
    if (totalRounds >= 5) return 4;
    return totalRounds;
  }

  // Textový popisek aktuálně platné úrovně pravidla (pro zobrazení v UI) -
  // vždy odvozený ze stejných prahů jako bestOfThreshold, takže se nemůže rozejít.
  function bestOfTierLabel(totalRounds) {
    if (totalRounds >= 9) return '9 a více turnajů → nejlepších 8';
    if (totalRounds >= 7) return '7–8 turnajů → nejlepších 6';
    if (totalRounds >= 5) return '5–6 turnajů → nejlepší 4';
    return '1–4 turnaje → počítají se všechny';
  }

  // Spočítá celkové body hráče jako součet `threshold` nejlepších výsledků
  // z pole bodů za jednotlivé turnaje (chybějící/neodehrané turnaje = 0, přirozeně vypadnou).
  function computeBestOfScore(roundPoints, threshold) {
    const sorted = [...roundPoints].sort((a, b) => b - a);
    return sorted.slice(0, threshold).reduce((s, v) => s + v, 0);
  }

  // ── Sezónní téma (barvy + jemné neonové dekorace) ──
  // Jedno místo pro celý web: barevné schéma (--purple/--pl/--pd/--pborder)
  // se přepíná podle aktuální sezóny, + pár tematických neonových ikon
  // (rozmístěné u okrajů obrazovky, jemné, pointer-events:none - nepřekáží).
  const SEASON_THEMES = {
    jaro:   { heroLabel:'Jarní',    purple:'#22c55e', pl:'#4ade80', pdRgb:'34,197,94',   icon:'flower' },
    leto:   { heroLabel:'Letní',    purple:'#f0a500', pl:'#ffcf4d', pdRgb:'240,165,0',   icon:'drop'   },
    podzim: { heroLabel:'Podzimní', purple:'#ff6b35', pl:'#ff9a66', pdRgb:'255,107,53',  icon:'leaf'   },
    zima:   { heroLabel:'Zimní',    purple:'#0ea5e9', pl:'#7dd3fc', pdRgb:'14,165,233',  icon:'snow'   },
  };

  const FX_ICONS = {
    flower: '<circle cx="20" cy="20" r="4"/><ellipse cx="20" cy="9" rx="5" ry="8"/><ellipse cx="31" cy="20" rx="8" ry="5"/><ellipse cx="20" cy="31" rx="5" ry="8"/><ellipse cx="9" cy="20" rx="8" ry="5"/>',
    drop:   '<path d="M20 4C20 4 9 19 9 27a11 11 0 0 0 22 0C31 19 20 4 20 4Z"/>',
    leaf:   '<path d="M7 33C6 15 23 5 34 5c1 15-7 29-26 29-4 0-4-2-1-1Z"/><path d="M10 31 27 12"/>',
    snow:   '<g stroke-linecap="round"><path d="M20 4v32M6 12l28 16M6 28l28-16"/><path d="M20 4l-4 4m4-4l4 4M20 36l-4-4m4 4l4-4M6 12l5 1m-5-1l1-5M34 12l-5 1m5-1l-1-5M6 28l1 5m-1-5l5-1M34 28l-1 5m1-5l-5-1"/></g>',
  };

  function ensureFxStyle() {
    if (document.getElementById('hn-fx-style')) return;
    const style = document.createElement('style');
    style.id = 'hn-fx-style';
    style.textContent = `
      #hn-season-fx{position:fixed;inset:0;z-index:2;pointer-events:none;overflow:hidden}
      .hn-fx-icon{position:absolute;top:-10vh;color:var(--pl,#d44fff);filter:drop-shadow(0 0 6px currentColor);animation-name:hnFxFall;animation-timing-function:linear;animation-iteration-count:infinite}
      .hn-fx-icon svg{display:block;fill:none;stroke:currentColor;stroke-width:1.4}
      @keyframes hnFxFall{
        0%   {transform:translate(0,-10vh) rotate(0deg);opacity:0}
        8%   {opacity:var(--op,.18)}
        50%  {transform:translate(var(--dx,24px),50vh) rotate(calc(var(--rot,220deg) * .5))}
        92%  {opacity:var(--op,.18)}
        100% {transform:translate(calc(var(--dx,24px) * -1),115vh) rotate(var(--rot,220deg));opacity:0}
      }
      @media(max-width:640px){.hn-fx-icon:nth-child(n+9){display:none}}
      @media(prefers-reduced-motion:reduce){.hn-fx-icon{animation:none;display:none}}
    `;
    document.head.appendChild(style);
  }

  function buildFxItems(count) {
    const items = [];
    for (let i = 0; i < count; i++) {
      const left = Math.min(97, Math.max(1, (i / count) * 100 + (Math.random() * 9 - 4.5)));
      items.push({
        left,
        size: 16 + Math.round(Math.random() * 20),
        duration: (9 + Math.random() * 9).toFixed(1),
        delay: (Math.random() * 14).toFixed(1),
        dx: Math.round(Math.random() * 70 - 35),
        rot: Math.round(160 + Math.random() * 200) * (Math.random() > 0.5 ? 1 : -1),
        op: (0.12 + Math.random() * 0.1).toFixed(2),
      });
    }
    return items;
  }

  function renderSeasonFx(iconKey) {
    ensureFxStyle();
    let layer = document.getElementById('hn-season-fx');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'hn-season-fx';
      document.body.appendChild(layer);
    }
    const path = FX_ICONS[iconKey] || FX_ICONS.flower;
    const items = buildFxItems(13);
    layer.innerHTML = items.map(p => `
      <div class="hn-fx-icon" style="left:${p.left.toFixed(1)}%;width:${p.size}px;height:${p.size}px;--dx:${p.dx}px;--rot:${p.rot}deg;--op:${p.op};animation-duration:${p.duration}s;animation-delay:${p.delay}s">
        <svg viewBox="0 0 40 40">${path}</svg>
      </div>`).join('');
  }

  // Vrátí klíč sezóny (jaro/leto/podzim/zima) podle názvu z Master Sheetu
  function seasonKeyFrom(activeSeason) {
    const name = activeSeason || 'Léto 2026';
    return Object.keys(SEASON_THEMES).find(k => name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(k)) || 'leto';
  }

  // Rychlý odhad sezóny podle dnešního data (bez čekání na Master Sheet).
  // Používá se pro okamžité nastavení tématu hned při načtení stránky -
  // eliminuje "probliknutí" starou barvou/sezónou, než doběhne síťový dotaz.
  function guessSeasonName(date) {
    const d = date || new Date();
    const m = d.getMonth() + 1; // 1-12
    const y = d.getFullYear();
    if (m >= 3 && m <= 5) return `Jaro ${y}`;
    if (m >= 6 && m <= 8) return `Léto ${y}`;
    if (m >= 9 && m <= 11) return `Podzim ${y}`;
    return `Zima ${m === 12 ? y : y - 1}`;
  }

  function applySeasonThemeGuess() {
    return applySeasonTheme(guessSeasonName());
  }

  // Hlavní funkce - zavolá se na každé stránce, jakmile je známá aktuální sezóna.
  function applySeasonTheme(activeSeason) {
    const key = seasonKeyFrom(activeSeason);
    const theme = SEASON_THEMES[key];

    document.documentElement.style.setProperty('--purple', theme.purple);
    document.documentElement.style.setProperty('--pl', theme.pl);
    document.documentElement.style.setProperty('--pd', `rgba(${theme.pdRgb},0.15)`);
    document.documentElement.style.setProperty('--pd-faint', `rgba(${theme.pdRgb},0.04)`);
    document.documentElement.style.setProperty('--pborder', `rgba(${theme.pdRgb},0.3)`);

    renderSeasonFx(theme.icon);
    return { key, theme };
  }

  let _loadPromise = null;

  // ── Ochrana proti tichému fallbacku Google gviz API ──
  // Google gviz endpoint (tqx=out:csv&sheet=NÁZEV) občas, když NÁZEV listu
  // neexistuje, MÍSTO CHYBY tiše vrátí data z prvního/výchozího listu tabulky.
  // To vypadá jako platná data, ale patří jinému (špatnému) listu.
  // Řešení: pro každý Sheet ID jednou zjistíme skutečný seznam názvů listů
  // přes starší, ale stále veřejně funkční "worksheets feed" API. Pokud se
  // to nepodaří (API nedostupné), přistoupíme k datům bez tohoto ověření
  // (stejné chování jako dřív) - je to bezpečnostní síť navíc, ne jediná obrana.
  const _tabListCache = {};
  async function getSheetTabTitles(sheetId) {
    if (_tabListCache[sheetId] !== undefined) return _tabListCache[sheetId];
    try {
      const url = `https://spreadsheets.google.com/feeds/worksheets/${sheetId}/public/basic?alt=json`;
      const res = await fetch(url);
      if (!res.ok) { _tabListCache[sheetId] = null; return null; }
      const json = await res.json();
      const entries = (json.feed && json.feed.entry) || [];
      const titles = entries.map(e => e.title && e.title['$t']).filter(Boolean);
      _tabListCache[sheetId] = titles;
      return titles;
    } catch (e) {
      _tabListCache[sheetId] = null;
      return null;
    }
  }

  // Stáhne konkrétní list (tab) konkrétní tabulky (liga) podle jména sezóny.
  // Vrací pole CSV řádků, nebo null pokud list neexistuje / je prázdný / chyba.
  async function fetchLeagueTab(sheetId, tabName) {
    const cleanId = (sheetId || '').replace(/.*\/d\/([^/]+).*/, '$1').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId || !tabName) return null;

    // 1) Ověř, že list opravdu existuje (pokud se seznam podařilo zjistit)
    const titles = await getSheetTabTitles(cleanId);
    if (titles) {
      const wanted = tabName.trim().toLowerCase();
      const exists = titles.some(t => (t || '').trim().toLowerCase() === wanted);
      if (!exists) return null;
    }

    // 2) Stáhni samotná data
    const url = `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&_=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    if (text.includes('google.visualization') || text.trim().startsWith('/*') || text.includes('#REF')) return null;
    const rows = parseCSV(text);
    if (rows.length < 2) return null;
    return rows;
  }

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
        //
        // Formát: řádek s vyplněným "Nadpis" založí novou kartu pravidla.
        // Řádek s PRÁZDNÝM "Nadpis" (jen vyplněný "Text") se přidá jako další
        // řádek/odrážka k PŘEDCHOZÍ kartě - takže se odrážky dají zapisovat
        // jako obyčejné další řádky tabulky, bez nutnosti víceřádkových buněk.
        try {
          const pravRows = await fetchTab('Pravidla');
          const rules = [];
          pravRows.slice(1).forEach(r => {
            const heading = (r[0] || '').trim();
            const textLine = (r[1] || '').trim();
            if (!heading && !textLine) return; // prázdný řádek
            if (heading) {
              rules.push({ heading, lines: textLine ? [textLine] : [] });
            } else if (rules.length) {
              rules[rules.length - 1].lines.push(textLine);
            }
          });
          data.rules = rules.map(r => ({ heading: r.heading, text: r.lines.join('\n') }));
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

  // Stejné jako fetchLeagueTab, ale vrací syrový CSV text místo naparsovaných
  // řádků - pro stránky s vlastním parserem (tcg-liga-detail.html, tcg-archiv-detail.html).
  async function fetchLeagueTabText(sheetId, tabName) {
    const cleanId = (sheetId || '').replace(/.*\/d\/([^/]+).*/, '$1').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId || !tabName) throw new Error('Chybí Sheet ID nebo název listu.');

    const titles = await getSheetTabTitles(cleanId);
    if (titles) {
      const wanted = tabName.trim().toLowerCase();
      const exists = titles.some(t => (t || '').trim().toLowerCase() === wanted);
      if (!exists) throw new Error(`List "${tabName}" v tabulce neexistuje.`);
    }

    const url = `https://docs.google.com/spreadsheets/d/${cleanId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&_=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`List "${tabName}" nenalezen nebo Sheets není veřejný.`);
    const text = await res.text();
    if (text.includes('google.visualization') || text.trim().startsWith('/*') || text.includes('#REF')) {
      throw new Error(`List "${tabName}" nenalezen.`);
    }
    return text;
  }

  // Spusť se hned při načtení tohoto skriptu (ještě před fetch na Master Sheet) -
  // stránka tak od první vteřiny ukazuje správnou sezónní barvu/dekorace místo
  // výchozí (staré) hodnoty. HN.applySeasonTheme() se pak zavolá znovu s přesnými
  // daty ze Sheets a případně to jemně doladí.
  try { applySeasonThemeGuess(); } catch (e) {}

  return { MASTER_SHEET_ID, LEAGUES, LEAGUE_NAME_MAP, parseCSV, fetchTab, fetchLeagueTab, fetchLeagueTabText, getSheetTabTitles, bestOfThreshold, bestOfTierLabel, computeBestOfScore, applySeasonTheme, guessSeasonName, applySeasonThemeGuess, load };
})();
