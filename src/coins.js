// Muenzen: Startguthaben (optional als Ausgleich nach der hoechsten Ranked-Duels-Wertung), Verdienst pro Runde
// nach der Punktzahl des Guess, Ausgaben fuer Kisten und Flueche. Ein Konto pro Spiel-ID, gespeichert in localStorage.
// Andere Teile nutzen G.coins (active, balance, canAfford, spend, earn, lock, unlock, lockedUntil).
(() => {
  'use strict';

  const G = window.__ggx;

  const ENABLED_KEY = 'ggx-coins-enabled';
  const HANDICAP_KEY = 'ggx-coins-handicap';
  const WALLET_PREFIX = 'ggx-coins:';
  const MAX_WALLETS = 20;

  const DEFAULT_START = 100; // ohne Rating-Ausgleich oder wenn die Wertung nicht ladbar ist
  const UNRANKED_START = 130; // noch nie Ranked gespielt
  const START_RANGE = [60, 160];
  const BASE_EARN = 5; // pro abgegebenem Guess
  const POINTS_PER_COIN = 250; // 5000 Punkte = +20
  const SCORE_FALLBACK_MS = 20000;
  const WORLD_SIZE_KM = 14916.862;

  // Startguthaben je nach hoechster Wertung: 0 -> 160, 1000 -> 100, 1200 -> 90, 1700+ -> 60.
  function startFor(peak) {
    if (peak == null) return UNRANKED_START;
    const raw = 160 - peak * 0.06;
    return G.clamp(Math.round(raw / 5) * 5, START_RANGE[0], START_RANGE[1]);
  }

  const state = {
    enabled: G.ui.load(ENABLED_KEY, '1') === '1',
    handicap: G.ui.load(HANDICAP_KEY, '1') === '1',
    gameId: null,
    wallet: null, // { start, peak, balance, awarded: { runde: muenzen }, locks: { schluessel: runde }, last, created }
    loading: null,
    pending: null, // abgeschickter Guess, fuer den noch keine Muenzen verbucht sind
    flash: 0,
  };

  function gameId() {
    return G.multiplayerGameId() ?? G.singleGameId();
  }

  // ---------- Speicher ----------

  function save() {
    if (!state.wallet || !state.gameId) return;
    G.ui.save(WALLET_PREFIX + state.gameId, JSON.stringify(state.wallet));
  }

  function loadStored(id) {
    try {
      const wallet = JSON.parse(localStorage.getItem(WALLET_PREFIX + id) ?? 'null');
      return Number.isFinite(wallet?.balance) ? wallet : null;
    } catch {
      return null;
    }
  }

  // Alte Konten wegraeumen, damit localStorage nicht vollaeuft.
  function prune() {
    try {
      const wallets = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key?.startsWith(WALLET_PREFIX)) continue;
        let created = 0;
        try {
          created = JSON.parse(localStorage.getItem(key))?.created ?? 0;
        } catch {
          // Kaputter Eintrag wird als aeltester entfernt.
        }
        wallets.push({ key, created });
      }
      wallets.sort((a, b) => b.created - a.created);
      wallets.slice(MAX_WALLETS).forEach(({ key }) => localStorage.removeItem(key));
    } catch {
      // Kein Zugriff auf localStorage.
    }
  }

  // ---------- Wertung ----------

  // Hoechste Ranked-Duels-Wertung: undefined = nicht ladbar, null = nie Ranked gespielt.
  async function loadPeakRating() {
    const user = await G.profile();
    if (!user?.id) return undefined;
    try {
      const response = await G.originalFetch(`https://www.geoguessr.com/api/v4/ranked-system/peak-rating/${encodeURIComponent(user.id)}`, { credentials: 'include' });
      if (response.status === 404) return null;
      if (!response.ok) return undefined;
      const data = await response.json();
      const values = [data?.peakOverallRating, ...Object.values(data?.peakGameModeRatings ?? {})].filter((value) => Number.isFinite(value) && value > 0);
      return values.length ? Math.max(...values) : null;
    } catch {
      return undefined;
    }
  }

  async function createWallet(id) {
    let peak;
    let start = DEFAULT_START;
    if (state.handicap) {
      peak = await Promise.race([loadPeakRating(), new Promise((resolve) => window.setTimeout(resolve, 5000))]);
      if (peak !== undefined) start = startFor(peak);
    }
    if (state.gameId !== id || state.wallet) return;
    state.wallet = { start, peak: peak ?? null, rated: peak !== undefined && state.handicap, balance: start, awarded: {}, locks: {}, last: '', created: Date.now() };
    save();
    prune();
    G.log('Münzkonto angelegt:', start, 'Münzen, Wertung', peak);
    G.render();
  }

  function syncWallet() {
    const id = state.enabled && G.active ? gameId() : null;
    if (id === state.gameId) return;
    state.gameId = id;
    state.wallet = id ? loadStored(id) : null;
    state.pending = null;
    if (id && !state.wallet) createWallet(id);
    G.render();
  }

  // ---------- Verdienen ----------

  // Rating-Ausgleich auch beim Verdienst: Faktor = Startguthaben / 100 (Bestwertung 1200 -> x0,9, 1700+ -> x0,6,
  // nie Ranked -> x1,3). Ohne Ausgleich x1.
  function earnFactor(wallet) {
    return wallet.rated ? wallet.start / DEFAULT_START : 1;
  }

  function coinsForScore(score, wallet) {
    return Math.max(1, Math.round((BASE_EARN + score / POINTS_PER_COIN) * earnFactor(wallet)));
  }

  function formatFactor(wallet) {
    return `×${earnFactor(wallet).toLocaleString('de-DE', { maximumFractionDigits: 2 })}`;
  }

  function award(round, score, estimated) {
    const wallet = state.wallet;
    if (!wallet || !round || wallet.awarded[round] != null) return;
    const amount = coinsForScore(score, wallet);
    wallet.awarded[round] = amount;
    wallet.balance += amount;
    const points = Math.round(score).toLocaleString('de-DE');
    wallet.last = `Runde ${round}: +${amount} 🪙 für ${estimated ? '≈ ' : ''}${points} Punkte`;
    save();
    G.ui.toast(`🪙 +${amount} Münzen (${estimated ? '≈ ' : ''}${points} Punkte)`, 2500);
    state.flash = Date.now();
    G.render();
  }

  // Sucht in einer API-Antwort den eigenen Guess (gleiche Koordinaten) und liest dessen Punktzahl.
  function readScore(item) {
    const candidates = [item.roundScoreInPoints, item.roundScore?.amount, item.roundScore, item.score, item.points];
    return candidates.find((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5000);
  }

  function findScore(value, guess, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8) return undefined;
    if (Number.isFinite(value.lat) && Number.isFinite(value.lng) && Math.abs(value.lat - guess.lat) < 1e-4 && Math.abs(G.lngDelta(value.lng, guess.lng)) < 1e-4) {
      const score = readScore(value);
      if (score !== undefined) return score;
    }
    for (const child of Object.values(value)) {
      const score = findScore(child, guess, depth + 1);
      if (score !== undefined) return score;
    }
    return undefined;
  }

  // GeoGuessr-Formel fuer die Weltkarte als Schaetzung, falls die echte Punktzahl nicht auftaucht.
  function estimateScore(pending) {
    if (!pending.target) return 0;
    const km = G.distanceKm(pending, pending.target);
    return 5000 * Math.exp((-10 * km) / WORLD_SIZE_KM);
  }

  function settlePending(score, estimated) {
    const pending = state.pending;
    if (!pending) return;
    state.pending = null;
    window.clearTimeout(pending.timer);
    award(pending.round, score, estimated);
  }

  // ---------- Oeffentliche Schnittstelle ----------

  G.coins = {
    // Muenzen gelten gerade (eingeschaltet, im Spiel, Konto bereit)?
    active: () => state.enabled && !!state.wallet && state.gameId === gameId(),
    // Eingeschaltet und im Spiel, Konto evtl. noch im Aufbau.
    wanted: () => state.enabled && G.active && !!gameId(),
    balance: () => state.wallet?.balance ?? 0,
    canAfford: (amount) => (state.wallet?.balance ?? 0) >= amount,
    spend(amount, label) {
      if (!G.coins.active() || state.wallet.balance < amount) return false;
      state.wallet.balance -= amount;
      G.log('Münzen ausgegeben:', amount, label ?? '');
      save();
      G.render();
      return true;
    },
    earn(amount, label) {
      if (!G.coins.active() || amount <= 0) return;
      state.wallet.balance += amount;
      G.log('Münzen erhalten:', amount, label ?? '');
      save();
      G.render();
    },
    // Sperre bis einschliesslich Runde untilRound - 1 (gesperrt, solange G.roundNumber < untilRound).
    lock(key, rounds) {
      if (!G.coins.active()) return;
      state.wallet.locks[key] = (G.roundNumber || 1) + rounds;
      save();
    },
    unlock(key) {
      if (!state.wallet) return;
      delete state.wallet.locks[key];
      save();
    },
    // Runde, ab der wieder frei, oder 0.
    lockedUntil(key) {
      const until = state.wallet?.locks[key] ?? 0;
      return until > (G.roundNumber || 1) ? until : 0;
    },
  };

  // ---------- Panel ----------

  function render(body) {
    if (!G.active || !gameId()) return;
    const ui = G.ui;
    if (!state.enabled) {
      ui.button(body, '🪙 Münzen einschalten', () => {
        state.enabled = true;
        ui.save(ENABLED_KEY, '1');
        syncWallet();
      }, { ghost: true });
      return;
    }
    const wallet = state.wallet;
    if (!wallet) {
      ui.text(body, '🪙 Münzkonto wird angelegt …', { className: 'ggx-section-title' });
      return;
    }
    const title = ui.text(body, `🪙 ${wallet.balance} Münzen`, { className: 'ggx-big' });
    if (Date.now() - state.flash < 2500) title.style.color = '#ffd84a';
    let origin = `Start: ${wallet.start}`;
    if (wallet.rated) origin += wallet.peak == null ? ' (noch kein Ranked)' : ` (Bestwertung ${wallet.peak})`;
    let rule = `pro Guess +${BASE_EARN} plus 1 je ${POINTS_PER_COIN} Punkte`;
    if (wallet.rated) rule += `, Belohnung ${formatFactor(wallet)}`;
    ui.text(body, `${origin} · ${rule}`, { className: 'ggx-muted ggx-center' });
    if (wallet.last) ui.text(body, wallet.last, { className: 'ggx-muted ggx-center' });
  }

  // Einstellungen, die erst fuer neue Spiele gelten, stehen unter dem Fluch-Bereich.
  function renderSettings(body) {
    if (!G.active || !gameId()) return;
    const ui = G.ui;
    if (!state.enabled) return;
    ui.choice(body, [{ id: 'on', label: 'Rating-Ausgleich' }, { id: 'off', label: 'Alle gleich' }], state.handicap ? 'on' : 'off', (id) => {
      state.handicap = id === 'on';
      ui.save(HANDICAP_KEY, state.handicap ? '1' : '0');
      G.render();
    });
    ui.text(body, 'Startguthaben-Regel gilt ab dem nächsten Spiel.', { className: 'ggx-muted' });
    ui.button(body, 'Münzen ausschalten', () => {
      state.enabled = false;
      ui.save(ENABLED_KEY, '0');
      syncWallet();
    }, { ghost: true });
  }

  // ---------- Verdrahtung ----------

  G.ui.addSection({ render, order: -1 });
  G.ui.addSection({ render: renderSettings, order: 10 });

  G.on('active', syncWallet);
  G.on('inactive', () => {
    if (state.pending) settlePending(estimateScore(state.pending), true);
    syncWallet();
  });
  G.on('tick', syncWallet);

  G.on('sent', (data) => {
    syncWallet();
    if (!G.coins.active() || !G.roundNumber || state.wallet.awarded[G.roundNumber] != null) return;
    if (state.pending) settlePending(estimateScore(state.pending), true);
    const pending = { round: G.roundNumber, lat: data.lat, lng: data.lng, target: G.target ? { ...G.target } : null, timer: 0 };
    pending.timer = window.setTimeout(() => {
      if (state.pending === pending) settlePending(estimateScore(pending), true);
    }, SCORE_FALLBACK_MS);
    state.pending = pending;
  });

  G.on('data', (json) => {
    const pending = state.pending;
    if (!pending) return;
    const score = findScore(json, pending);
    if (score !== undefined) settlePending(score, false);
  });
})();
