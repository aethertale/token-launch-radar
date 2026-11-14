// Token Radar (radar-2) — static dashboard. Reads window.RADAR from data.js
// and renders the board, the detail view, the live-token table and the model
// panel. No network: every value shown comes from data.js. All text is set
// through textContent, so snapshot strings are never parsed as markup.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model;
  var FLOOR = DATA.floor_usd;

  var state = {
    view: 'board', q: '', category: 'all', chain: 'all',
    watchlistOnly: false, minTvl: null,
    sortKey: 'implied', sortDir: -1, detailSlug: null
  };

  // ---------------------------------------------------------- formatting
  var usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(4);
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // ---------------------------------------------------------- dom helper
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }
  function $(id) { return document.getElementById(id); }

  // ---------------------------------------------------------- model math
  // The page recomputes a row from the snapshot figures, so the arithmetic
  // the model panel shows and the number board.json carries are visibly one
  // and the same. Median is the upper median: sorted[floor(n / 2)].
  function peerRowFor(category) {
    var hit = null;
    DATA.peer_multiples.forEach(function (p) { if (p.category === category) hit = p; });
    return hit;
  }
  function recompute(row) {
    var peer = peerRowFor(row.category);
    var multiple = peer ? peer.multiple : clamp(DATA.global_median, M.clamp_min, M.clamp_max);
    var growthPct = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, M.growth_floor, M.growth_cap);
    var growthMult = 1 + (growthPct / 100) * M.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? M.unknown_age_days : row.age_days;
    var maturityMult = M.maturity_floor + (clamp(age, 0, M.maturity_days) / M.maturity_days) * M.maturity_range;
    var base = row.tvl_usd * multiple;
    var implied = Math.max(1, Math.round(base * growthMult * maturityMult));
    return { peer: peer, multiple: multiple, growthPct: growthPct, growthMult: growthMult, age: age, ageKnown: row.age_days !== null && row.age_days !== undefined, maturityMult: maturityMult, base: base, implied: implied };
  }

  // The peer basis behind the multiple actually applied, in words. The
  // median cited here is always the multiple the model used: with fewer
  // than peer_min_n tokenised peers the category median is NOT used — the
  // global median is, and the sentence says so, naming both numbers.
  function peerBasis(c) {
    var peer = c.peer;
    if (!peer) return 'global median ' + fmtMult(c.multiple) + ' — no tokenised peers in this category';
    if (peer.n < M.peer_min_n) return 'only ' + peer.n + ' tokenised peer' + (peer.n === 1 ? '' : 's') + ' in this category, so the global median ' + fmtMult(c.multiple) + ' applies instead of the category median ' + fmtMult(peer.median);
    if (peer.median < M.clamp_min || peer.median > M.clamp_max) return 'category median ' + fmtMult(peer.median) + ' over ' + peer.n + ' tokenised peers, clamped to ' + fmtMult(c.multiple);
    return 'category median ' + fmtMult(c.multiple) + ' over ' + peer.n + ' tokenised peers';
  }

  // ---------------------------------------------------------- hash routing
  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    state.detailSlug = params.get('detail') || null;
    state.watchlistOnly = params.get('watchlist') === '1';
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('q') !== null) state.q = params.get('q');
    if (params.get('minTvl')) { var v = Number(params.get('minTvl')); state.minTvl = isFinite(v) && v > 0 ? v : null; }
    if (params.get('view') === 'live' || params.get('view') === 'model') state.view = params.get('view');
    else if (!state.detailSlug) state.view = 'board';
    if (state.detailSlug) state.view = 'detail';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.detailSlug) params.set('detail', state.detailSlug);
    if (state.view === 'live' || state.view === 'model') params.set('view', state.view);
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // ---------------------------------------------------------- board
  function isWatchlist(row) { return row.tvl_usd >= FLOOR; }
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !isWatchlist(r)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sortKey, dir = state.sortDir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d; bv = b.change_7d; }
      else if (key === 'age') { av = a.age_days; bv = b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function renderBoard() {
    var list = sortedRows(filteredRows());
    var tbody = $('board-body');
    tbody.textContent = '';
    $('board-empty').hidden = list.length !== 0;
    $('row-count').textContent = list.length + ' of ' + DATA.board_size + ' rows shown';
    document.querySelectorAll('#board-table thead th button').forEach(function (btn) {
      var old = btn.querySelector('.arrow');
      if (old) old.remove();
      if (btn.getAttribute('data-sort') === state.sortKey) {
        btn.appendChild(el('span', { class: 'arrow', text: state.sortDir < 0 ? ' ▼' : ' ▲' }));
      }
    });
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chains = (r.chains || []).slice(0, 3).join(', ');
      if ((r.chains || []).length > 3) chains += ' +' + (r.chains.length - 3);
      var tr = el('tr', {
        'data-clickable': 'true', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (chains || 'chain not listed') })
        ), ' ', el('span', { class: 'tag' + (isWatchlist(r) ? ' watch' : ''), text: isWatchlist(r) ? 'watchlist' : 'early' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) })
      );
      tbody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------- detail
  function openDetail(slug) {
    state.detailSlug = slug;
    state.view = 'detail';
    writeHash();
    render();
    window.scrollTo(0, 0);
  }
  function closeDetail() {
    state.detailSlug = null;
    state.view = 'board';
    writeHash();
    render();
  }
  function renderDetail() {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.detailSlug) row = r; });
    var body = $('detail-body');
    body.textContent = '';
    if (!row) {
      body.appendChild(el('p', { text: 'No protocol with that slug is on this board.' }));
      return;
    }
    var c = recompute(row);
    var peer = c.peer;
    var above = row.rank - 1, below = DATA.board_size - row.rank;
    body.appendChild(el('p', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (isWatchlist(row) ? 'watchlist' : 'early radar') }));
    body.appendChild(el('h2', { text: row.name }));
    body.appendChild(el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + ((row.chains || []).join(', ') || 'chain not listed') + ' · slug ' + row.slug }));
    var facts = el('div', { class: 'facts' });
    [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['7-day change', fmtPct(row.change_7d)],
      ['Market cap', row.mcap_usd === null ? 'records no token' : fmtUsd(row.mcap_usd)],
      ['First listed', row.listed_at || 'not in snapshot'],
      ['Age', row.age_days === null ? 'unknown — model counts 365 days' : row.age_days + ' days'],
      ['Implied value', fmtUsd(row.implied_value_usd)]
    ].forEach(function (f) {
      facts.appendChild(el('div', { class: 'fact' }, el('span', { text: f[0] }), el('b', { text: f[1] })));
    });
    body.appendChild(facts);
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Model breakdown — radar-2' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Peer multiple (' + (row.category || 'Uncategorised') + (peer ? ', n = ' + peer.n : ', global fallback') + ')' }), el('b', { text: fmtMult(c.multiple) })),
        el('div', null, el('span', { text: 'Base value (TVL × multiple)' }), el('b', { text: fmtUsd(c.base) })),
        el('div', null, el('span', { text: 'Growth multiplier (' + fmtPct(row.change_7d) + ' over 7d, clamped)' }), el('b', { text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier (' + (c.ageKnown ? row.age_days + ' days' : 'age unknown, 365 days') + ')' }), el('b', { text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Recomputed live from the snapshot figures: ' + fmtUsd(c.implied) + (c.implied === row.implied_value_usd ? ' — the same number the board carries.' : ' — differs from the board; the data would be stale.') }),
      el('p', { class: 'why', text: 'Why this ranks here: ' + fmtUsd(row.tvl_usd) + ' of TVL × ' + fmtMult(c.multiple) + ' (' + (row.category || 'Uncategorised') + ' peer multiple — ' + peerBasis(c) + ') gives a ' + fmtUsd(c.base) + ' base; ' + fmtPct(row.change_7d) + ' over 7 days moves it ×' + row.growth_multiplier + '; ' + (c.ageKnown ? row.age_days + ' days without a token' : 'an unknown age, counted as 365 days') + ' moves it ×' + row.maturity_multiplier + '. ' + (above === 0 ? 'No protocol scores higher.' : above + (above === 1 ? ' protocol scores' : ' protocols score') + ' higher and ' + below + ' lower.') })
    ));
    var steps = row.farm_steps || [];
    var ol = el('ol', { class: 'steps' });
    steps.forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      ol.appendChild(el('li', null, el('span', { text: action }), tail ? el('span', { class: 'cost', text: tail }) : null));
    });
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — 6 steps' }),
      steps.length ? ol : el('p', { class: 'sub', text: 'No farm plan is recorded for this protocol.' })
    ));
    body.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'In plain words' }),
      el('p', { class: 'judge', text: row.name + ' locks ' + fmtUsd(row.tvl_usd) + ' and records no token. Similar protocols whose tokens do trade are worth a median ' + fmtMult(c.multiple) + ' times their locked value, so the model values this one at ' + fmtUsd(row.implied_value_usd) + ' — its locked value times that peer multiple, nudged for last week\'s growth and for how long it has run without a token. That is an estimate of what a launch could be worth, not a price and not a promise.' })
    ));
  }

  // ---------------------------------------------------------- live + model
  function renderLive() {
    var tbody = $('live-body');
    tbody.textContent = '';
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.chains || []).slice(0, 3).join(', ') || 'chain not listed' })
        )),
        el('td', { text: r.category || 'Uncategorised' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) })
      ));
    });
  }
  function renderModel() {
    $('formula').textContent =
      'implied = round( tvl_usd × peerMultiple(category) × (1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 × ' + M.growth_weight + ') × (' + M.maturity_floor + ' + min(age_days, ' + M.maturity_days + ') / ' + M.maturity_days + ' × ' + M.maturity_range + ') )';
    var consts = $('consts');
    consts.textContent = '';
    [
      ['Growth weight', String(M.growth_weight)],
      ['Growth clamp', M.growth_floor + '% to +' + M.growth_cap + '%'],
      ['Maturity floor / range', M.maturity_floor + ' + up to ' + M.maturity_range],
      ['Maturity horizon', M.maturity_days + ' days (3 years)'],
      ['Unknown age counts as', M.unknown_age_days + ' days'],
      ['Peers needed per category', 'n ≥ ' + M.peer_min_n + ', else global median'],
      ['Multiple clamp', '[' + M.clamp_min + ', ' + M.clamp_max + ']'],
      ['Global median mcap/TVL', fmtMult(DATA.global_median)]
    ].forEach(function (kv) {
      consts.appendChild(el('div', null, el('dt', { text: kv[0] }), el('dd', { text: kv[1] })));
    });
    var top = DATA.rows[0];
    var c = recompute(top);
    var peer = c.peer;
    var worked = $('worked');
    worked.textContent = '';
    [
      ['TVL', fmtUsd(top.tvl_usd)],
      ['Peer multiple — ' + (top.category || 'Uncategorised') + ' (' + peerBasis(c) + ')', fmtMult(c.multiple)],
      ['Base value (TVL × multiple)', fmtUsd(c.base)],
      ['Growth multiplier — ' + fmtPct(top.change_7d) + ' over 7d', '×' + c.growthMult.toFixed(4)],
      ['Maturity multiplier — ' + (c.ageKnown ? top.age_days + ' days' : 'age unknown, 365 days'), '×' + c.maturityMult.toFixed(4)],
      ['Implied value (recomputed)', fmtUsd(c.implied)]
    ].forEach(function (kv, i, arr) {
      worked.appendChild(el('div', { class: 'worked-step' + (i === arr.length - 1 ? ' worked-total' : '') },
        el('span', { text: kv[0] }), el('b', { text: kv[1] })));
    });
    worked.appendChild(el('p', { class: 'sub', text: 'Worked example: ' + top.name + ', rank 1 of ' + DATA.board_size + '. The board carries ' + fmtUsd(top.implied_value_usd) + (c.implied === top.implied_value_usd ? ' — the recomputation matches.' : ' — the recomputation differs; the data would be stale.') }));
    var tbody = $('peer-body');
    tbody.textContent = '';
    DATA.peer_multiples.forEach(function (p) {
      var basis;
      if (p.n >= M.peer_min_n) basis = (p.median < M.clamp_min || p.median > M.clamp_max) ? 'category median, clamped' : 'category median';
      else basis = 'global median (n < ' + M.peer_min_n + ')';
      tbody.appendChild(el('tr', null,
        el('td', { text: p.category }),
        el('td', { class: 'num', text: String(p.n) }),
        el('td', { class: 'num', text: fmtMult(p.median) }),
        el('td', { class: 'num', text: fmtMult(p.multiple) }),
        el('td', { class: 'sub', text: basis })
      ));
    });
  }

  // ---------------------------------------------------------- chrome
  function fillChrome() {
    $('meta-model').textContent = 'model ' + DATA.model_version;
    $('meta-asof').textContent = 'Snapshot ' + DATA.as_of;
    $('stat-watchlist').textContent = String(DATA.watchlist_size);
    $('stat-board').textContent = String(DATA.board_size);
    $('stat-early').textContent = String(DATA.early_size);
    $('stat-floor').textContent = fmtUsd(FLOOR);
    $('stat-top').textContent = DATA.rows.length ? fmtUsd(DATA.rows[0].implied_value_usd) : 'n/a';
    $('model-summary').textContent = 'Model ' + DATA.model_version + ': implied value = TVL × peer multiple × growth × maturity. The peer multiple is the median market-cap/TVL of tokenised protocols in the same category (n ≥ ' + M.peer_min_n + ', else the global median ' + fmtMult(DATA.global_median) + '), clamped to [' + M.clamp_min + ', ' + M.clamp_max + ']. Snapshot ' + DATA.as_of + ' · ' + DATA.board_size + ' rows.';
    $('method-source').textContent = 'Snapshot as of ' + DATA.as_of + '.';
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category; }).filter(function (c) { return c !== null; }))).sort();
    var catSel = $('category');
    cats.forEach(function (c) {
      catSel.appendChild(el('option', { value: c, text: c }));
    });
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var chainSel = $('chain');
    chains.forEach(function (c) {
      chainSel.appendChild(el('option', { value: c, text: c }));
    });
  }

  function showView() {
    $('view-board').hidden = state.view !== 'board';
    $('view-detail').hidden = state.view !== 'detail';
    $('view-live').hidden = state.view !== 'live';
    $('view-model').hidden = state.view !== 'model';
    $('tab-board').setAttribute('aria-pressed', state.view === 'board' || state.view === 'detail' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-pressed', state.view === 'live' ? 'true' : 'false');
    $('tab-model').setAttribute('aria-pressed', state.view === 'model' ? 'true' : 'false');
  }

  function syncControls() {
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('watchlist-only').checked = state.watchlistOnly;
    $('min-tvl').value = state.minTvl === null ? '' : String(state.minTvl);
  }

  function render() {
    showView();
    syncControls();
    if (state.view === 'board' || state.view === 'detail') renderBoard();
    if (state.view === 'detail') renderDetail();
    if (state.view === 'live') renderLive();
    if (state.view === 'model') renderModel();
  }

  // ---------------------------------------------------------- wiring
  $('q').addEventListener('input', function () { state.q = $('q').value; writeHash(); renderBoard(); });
  $('category').addEventListener('change', function () { state.category = $('category').value; writeHash(); renderBoard(); });
  $('chain').addEventListener('change', function () { state.chain = $('chain').value; writeHash(); renderBoard(); });
  $('watchlist-only').addEventListener('change', function () { state.watchlistOnly = $('watchlist-only').checked; writeHash(); renderBoard(); });
  $('min-tvl').addEventListener('input', function () {
    var v = Number($('min-tvl').value);
    state.minTvl = isFinite(v) && v > 0 ? v : null;
    writeHash(); renderBoard();
  });
  $('clear-filters').addEventListener('click', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; state.minTvl = null;
    writeHash(); render();
  });
  document.querySelectorAll('#board-table thead th button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-sort');
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = key === 'name' || key === 'rank' ? 1 : -1; }
      renderBoard();
    });
  });
  $('tab-board').addEventListener('click', function () { state.detailSlug = null; state.view = 'board'; writeHash(); render(); });
  $('tab-live').addEventListener('click', function () { state.detailSlug = null; state.view = 'live'; writeHash(); render(); });
  $('tab-model').addEventListener('click', function () { state.detailSlug = null; state.view = 'model'; writeHash(); render(); });
  $('back-board').addEventListener('click', closeDetail);
  window.addEventListener('hashchange', function () { readHash(); render(); });

  fillChrome();
  readHash();
  render();
})();
