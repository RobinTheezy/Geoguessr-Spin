// Modus "Tipp-Kiste": Lootboxen mit gestuften Hinweisen (und Fluechen), Normal- und Crazy-Variante.
(() => {
  'use strict';

  const G = window.__ggx;

  const VARIANT_KEY = 'gg-handicap-mode';
  const COOLDOWN_MS = { normal: 20000, crazy: 10000 };
  // Mit Muenzsystem: Preis pro Kiste statt Wartezeit (Crazy ist billiger, hat aber mehr Flueche).
  const PRICE = { normal: 15, crazy: 10 };
  const SPIN_MS = 5000;
  const RESULT_MS = 2800;
  const CARD_WIDTH = 110;
  const CARD_STEP = 116;
  const REEL_LENGTH = 52;
  const WINNER_INDEX = 44;

  const CONTINENTS = {
    Afrika: 'dz ao bj bw bf bi cv cm cf td km cg cd ci dj eg gq er sz et ga gm gh gn gw ke ls lr ly mg mw ml mr mu ma mz na ne ng rw st sn sc sl so za ss sd tz tg tn ug zm zw re yt sh',
    Asien: 'af am az bh bd bt bn kh cn ge hk in id ir iq il jp jo kz kw kg la lb mo my mv mn mm np kp om pk ps ph qa sa sg kr lk sy tw tj th tl tr tm ae uz vn ye',
    Europa: 'al ad at by be ba bg hr cy cz dk ee fo fi fr de gi gr gg hu is ie im it je xk lv li lt lu mt md mc me nl mk no pl pt ro ru sm rs sk si es sj se ch ua gb va ax',
    Nordamerika: 'ag bs bb bz bm ca cr cu dm do sv gl gd gp gt ht hn jm mq mx ni pa pr kn lc vc tt us vi vg ky tc aw cw sx',
    Südamerika: 'ar bo br cl co ec fk gf gy py pe sr uy ve',
    Ozeanien: 'as au ck fj pf gu ki mh fm nr nc nz nu mp pw pg ws sb tk to tv vu wf',
  };

  const CONTINENT_BOUNDS = {
    Afrika: { south: -47, north: 38, west: -26, east: 60 },
    Asien: { south: -11, north: 56, west: 25, east: 150 },
    Europa: { south: 27, north: 81, west: -32, east: 180 },
    Nordamerika: { south: 7, north: 84, west: -170, east: -12 },
    Südamerika: { south: -56, north: 13, west: -110, east: -34 },
    Ozeanien: { south: -50, north: 30, west: 110, east: -120 },
  };

  const MAX_LAT = 85;
  const DIM_COLOR = '#0b0820';
  const DIM_OPACITY = 0.42;
  const NEAR_KM = 1500;

  const TIERS = {
    common: { label: 'Gewöhnlich', color: '#9aa4b2', weight: 45 },
    uncommon: { label: 'Ungewöhnlich', color: '#4fa3ff', weight: 27 },
    rare: { label: 'Selten', color: '#a66bff', weight: 15 },
    epic: { label: 'Episch', color: '#ff5db1', weight: 8 },
    gold: { label: 'Gold', color: '#ffd21f', weight: 4 },
    fivek: { label: '5K', color: '#ff3b3b', weight: 1 },
    curse: { label: 'Fluch', color: '#39e07a', weight: 2 },
  };

  const CURSE_SHIFT_KM = 30;
  const CURSE_BLUR_MS = 30000;
  const CURSE_LOCKOUT_MS = 60000;
  const CURSE_EFFECTS = ['kiste-invert', 'kiste-mirror', 'kiste-blur'];

  const CURSES = [
    ['curse-shift', 'Guess verrutscht', 'curse'],
    ['curse-invert', 'Farben invertiert', 'curse'],
    ['curse-mirror', 'Bild gespiegelt', 'curse'],
    ['curse-blur', 'Unscharf', 'curse'],
    ['curse-lockout', 'Kistensperre', 'curse'],
    ['curse-wipe', 'Tipps gelöscht', 'curse'],
  ];

  const formatNumber = G.formatNumber;

  // Breiten-/Laengengrad-Feld: je seltener, desto schmaler.
  function lat(size, tier) {
    return [`lat-${size}`, `Breitengrad ${formatNumber(size)}°`, tier];
  }

  function lng(size, tier) {
    return [`lng-${size}`, `Längengrad ${formatNumber(size)}°`, tier];
  }

  function circle(km, tier) {
    return [`circle-${km}`, `Suchkreis ${formatNumber(km)} km`, tier];
  }

  function buildCatalog(entries) {
    return entries.map(([id, title, tier]) => ({ id, title, tier }));
  }

  const CATALOG = buildCatalog([
    lat(10, 'common'), lng(10, 'common'), circle(2000, 'common'),
    ['continent', 'Kontinent', 'common'],
    ['click-ns', 'Nord/Süd vom Klick', 'common'],
    ['click-ew', 'Ost/West vom Klick', 'common'],
    ['click-near', 'Nah/fern vom Klick', 'common'],
    lat(5, 'uncommon'), lng(5, 'uncommon'), circle(1000, 'uncommon'),
    ['first-letter', 'Land: 1. Buchstabe', 'uncommon'],
    lat(2, 'rare'), lng(2, 'rare'), circle(500, 'rare'),
    ['domain', 'Landesdomain', 'rare'],
    ['distance', 'Distanz zum Klick', 'rare'],
    lat(1, 'epic'), lng(1, 'epic'), circle(200, 'epic'),
    ['country', 'Land', 'epic'],
    ['arrow', 'Richtungspfeil', 'epic'],
    lat(0.25, 'gold'), lng(0.25, 'gold'), circle(50, 'gold'),
    ['region', 'Region', 'gold'],
    ['county', 'Landkreis/Bezirk', 'gold'],
    ['exact', 'Exakte Koordinaten', 'fivek'],
    ...CURSES,
  ]);

  const CRAZY_WEIGHTS = { common: 25, uncommon: 25, rare: 22, epic: 16, gold: 9, fivek: 3, curse: 25 };

  const CRAZY_CATALOG = buildCatalog([
    lat(5, 'common'), lng(5, 'common'), circle(1000, 'common'),
    ['continent', 'Kontinent', 'common'],
    ['click-near', 'Nah/fern vom Klick', 'common'],
    lat(2, 'uncommon'), lng(2, 'uncommon'), circle(500, 'uncommon'),
    ['first-letter', 'Land: 1. Buchstabe', 'uncommon'],
    ['domain', 'Landesdomain', 'uncommon'],
    ['distance', 'Distanz zum Klick', 'uncommon'],
    ['turbo', 'Turbo', 'uncommon'],
    lat(1, 'rare'), lng(1, 'rare'), circle(200, 'rare'),
    ['country', 'Land', 'rare'],
    ['arrow', 'Richtungspfeil', 'rare'],
    lat(0.25, 'epic'), lng(0.25, 'epic'), circle(100, 'epic'),
    ['region', 'Region', 'epic'],
    lat(0.05, 'gold'), lng(0.05, 'gold'), circle(20, 'gold'),
    ['county', 'Landkreis/Bezirk', 'gold'],
    ['city', 'Ortsname', 'gold'],
    ['exact', 'Exakte Koordinaten', 'fivek'],
    ...CURSES,
  ]);

  const state = {
    variant: G.ui.load(VARIANT_KEY, 'normal') === 'crazy' ? 'crazy' : 'normal',
    info: null,
    loot: [],
    exhausted: false,
    spinning: false,
    spinToken: 0,
    overlay: null,
    nextCaseAt: 0,
    shownCooldown: 0,
    arrowOwned: false,
    arrowUsed: false,
    arrow: null,
    hintShapes: [],
    shiftGuess: false,
    message: '',
    paid: 0, // Preis der laufenden Kiste, falls sie scheitert
  };

  function useCoins() {
    return !!G.coins?.active();
  }

  function refundSpin() {
    if (state.paid) G.coins.earn(state.paid, 'Kiste zurück');
    state.paid = 0;
  }

  function activeCatalog() {
    return state.variant === 'crazy' ? CRAZY_CATALOG : CATALOG;
  }

  function tierWeight(tier) {
    return state.variant === 'crazy' ? CRAZY_WEIGHTS[tier] : TIERS[tier].weight;
  }

  function applyCurse(winner, token) {
    switch (winner.id) {
      case 'curse-shift':
        state.shiftGuess = true;
        break;
      case 'curse-invert':
        G.setPanoEffect('kiste-invert', { filter: 'invert(1)' });
        break;
      case 'curse-mirror':
        G.setPanoEffect('kiste-mirror', { transform: 'scaleX(-1)' });
        break;
      case 'curse-blur':
        G.setPanoEffect('kiste-blur', { filter: 'blur(8px)' });
        window.setTimeout(() => {
          if (token === G.roundToken && G.mode === mode) G.setPanoEffect('kiste-blur', null);
        }, CURSE_BLUR_MS);
        break;
      case 'curse-lockout':
        state.nextCaseAt = Date.now() + CURSE_LOCKOUT_MS;
        break;
      case 'curse-wipe':
        state.loot = state.loot.filter((item) => item.tier === 'curse');
        state.arrowOwned = false;
        clearArrow();
        drawHintShapes();
        break;
      default:
        break;
    }
  }

  function clearArrow() {
    state.arrow?.setMap(null);
    state.arrow = null;
  }

  function drawArrow() {
    clearArrow();
    const { target, lastClick, map } = G;
    if (!target || !lastClick || !map) return;
    state.arrow = new window.google.maps.Marker({
      position: lastClick,
      map,
      clickable: false,
      zIndex: 9999,
      icon: {
        path: 'M 0 -8 L 0 -64 M -11 -50 L 0 -64 L 11 -50',
        rotation: G.screenBearing(lastClick, target),
        strokeColor: '#ffd21f',
        strokeOpacity: 1,
        strokeWeight: 5,
        scale: 1,
      },
    });
  }

  function useArrow() {
    if (!state.arrowOwned || state.arrowUsed || !G.target || !G.lastClick) return;
    state.arrowUsed = true;
    drawArrow();
    G.render();
  }

  function cooldownSeconds() {
    return Math.max(0, Math.ceil((state.nextCaseAt - Date.now()) / 1000));
  }

  function continentOf(code) {
    return Object.keys(CONTINENTS).find((name) => CONTINENTS[name].split(' ').includes(code));
  }

  function degree(value, positive, negative) {
    if (value === 0) return '0°';
    return `${formatNumber(Math.abs(value))}°${value > 0 ? positive : negative}`;
  }

  function roundDegrees(value) {
    return Math.round(value * 1e6) / 1e6;
  }

  function bandStart(value, size) {
    return roundDegrees(Math.floor(value / size) * size);
  }

  function bandSize(id) {
    return Number(id.slice(4));
  }

  function band(value, size, positive, negative) {
    const start = bandStart(value, size);
    return `${degree(start, positive, negative)} bis ${degree(roundDegrees(start + size), positive, negative)}`;
  }

  function circleRadiusKm(id) {
    return Number(id.split('-')[1]);
  }

  function offsetPoint(target, maxKm) {
    return G.destinationPoint(target, maxKm * 0.8 * Math.sqrt(Math.random()), Math.random() * 2 * Math.PI);
  }

  function lootValue(id, target, info, lastClick) {
    const { code, country, region, county } = info;
    if (id.startsWith('circle-')) return `Ziel liegt im Kreis (Radius ${circleRadiusKm(id).toLocaleString('de-DE')} km)`;
    if (id.startsWith('lat-')) return band(target.lat, bandSize(id), 'N', 'S');
    if (id.startsWith('lng-')) return band(target.lng, bandSize(id), 'O', 'W');
    switch (id) {
      case 'county': return county ?? null;
      case 'city': return info.place ?? null;
      case 'turbo': return 'Nächste Kiste sofort';
      case 'curse-shift': return `Dein nächster Guess landet ${CURSE_SHIFT_KM} km daneben`;
      case 'curse-invert': return 'Bis Rundenende';
      case 'curse-mirror': return 'Bis Rundenende';
      case 'curse-blur': return `${CURSE_BLUR_MS / 1000} Sekunden`;
      case 'curse-lockout': return `Nächste Kiste erst in ${CURSE_LOCKOUT_MS / 1000} s`;
      case 'curse-wipe': return state.loot.some((item) => item.tier !== 'curse') ? 'Alle bisherigen Tipps weg' : null;
      case 'exact': return `${target.lat.toFixed(5)}, ${target.lng.toFixed(5)}`;
      case 'click-ns':
        if (!lastClick) return null;
        return target.lat >= lastClick.lat ? 'Nördlich deines Klicks' : 'Südlich deines Klicks';
      case 'click-ew':
        if (!lastClick) return null;
        return G.lngDelta(lastClick.lng, target.lng) >= 0 ? 'Östlich deines Klicks' : 'Westlich deines Klicks';
      case 'click-near': {
        if (!lastClick) return null;
        const km = NEAR_KM.toLocaleString('de-DE');
        return G.distanceKm(lastClick, target) < NEAR_KM ? `Unter ${km} km vom Klick` : `Über ${km} km vom Klick`;
      }
      case 'continent': return continentOf(code) ?? null;
      case 'first-letter': return country ? country[0] : null;
      case 'country': return country ?? null;
      case 'domain': return code ? `.${code === 'gb' ? 'uk' : code}` : null;
      case 'distance': return lastClick ? `${Math.round(G.distanceKm(lastClick, target)).toLocaleString('de-DE')} km` : null;
      case 'region': return region ?? null;
      case 'arrow': return 'Einmal nutzbar';
      default: return null;
    }
  }

  function availableLoot() {
    const drawn = new Set(state.loot.map((item) => item.id));
    return activeCatalog()
      .filter((item) => !drawn.has(item.id))
      .map((item) => ({ ...item, origin: G.lastClick, value: lootValue(item.id, G.target, state.info, G.lastClick) }))
      .filter((item) => item.value !== null);
  }

  function rollTier(tierIds) {
    const total = tierIds.reduce((sum, id) => sum + tierWeight(id), 0);
    let roll = Math.random() * total;
    for (const id of tierIds) {
      roll -= tierWeight(id);
      if (roll < 0) return id;
    }
    return tierIds[tierIds.length - 1];
  }

  function rollItem(items) {
    const tier = rollTier([...new Set(items.map((item) => item.tier))]);
    return G.randomFrom(items.filter((item) => item.tier === tier));
  }

  async function loadBoundary(item, target) {
    const zoom = { country: 3, region: 5, county: 8 }[item.id];
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${target.lat}&lon=${target.lng}&zoom=${zoom}&polygon_geojson=1&polygon_threshold=0.05`;
    try {
      const response = await G.originalFetch(url);
      const { geojson } = await response.json();
      if (!geojson || G.target !== target) return;
      item.geometry = geojson;
      drawHintShapes();
    } catch {
      // Ohne Umriss bleibt der Tipp als Text im Panel.
    }
  }

  // ---------- Hinweise auf der Karte ----------

  function clearHintShapes() {
    state.hintShapes.forEach((shape) => shape.setMap(null));
    state.hintShapes = [];
  }

  function addDim(maps, south, north, west, east) {
    state.hintShapes.push(new maps.Rectangle({
      map: G.map,
      bounds: { south, north, west, east },
      clickable: false,
      strokeWeight: 0,
      fillColor: DIM_COLOR,
      fillOpacity: DIM_OPACITY,
    }));
  }

  function dimOutsideLat(maps, allowed) {
    let south = -MAX_LAT;
    for (const [from, to] of allowed) {
      if (from > south) addDim(maps, south, from, -180, 180);
      south = Math.max(south, to);
    }
    if (south < MAX_LAT) addDim(maps, south, MAX_LAT, -180, 180);
  }

  function dimOutsideLng(maps, start, width) {
    let west = start + width;
    let remaining = 360 - width;
    while (remaining > 0) {
      const chunk = Math.min(remaining, 90);
      addDim(maps, -MAX_LAT, MAX_LAT, G.normalizeLng(west), G.normalizeLng(west + chunk));
      west += chunk;
      remaining -= chunk;
    }
  }

  function drawOutline(maps, item, color) {
    const layer = new maps.Data({ map: G.map });
    layer.addGeoJson({ type: 'Feature', geometry: item.geometry, properties: {} });
    layer.setStyle({ clickable: false, strokeColor: color, strokeWeight: 2, fillColor: color, fillOpacity: 0.16 });
    state.hintShapes.push(layer);
  }

  function drawHint(maps, item, target) {
    const color = TIERS[item.tier].color;
    if (item.center) {
      state.hintShapes.push(new maps.Circle({
        map: G.map,
        center: item.center,
        radius: circleRadiusKm(item.id) * 1000,
        clickable: false,
        strokeColor: color,
        strokeWeight: 3,
        fillColor: color,
        fillOpacity: 0.14,
      }));
      return;
    }
    if (item.id.startsWith('lat-')) {
      const start = bandStart(target.lat, bandSize(item.id));
      dimOutsideLat(maps, [[start, start + bandSize(item.id)]]);
      return;
    }
    if (item.id.startsWith('lng-')) {
      dimOutsideLng(maps, bandStart(target.lng, bandSize(item.id)), bandSize(item.id));
      return;
    }
    switch (item.id) {
      case 'exact':
        state.hintShapes.push(new maps.Marker({
          map: G.map,
          position: target,
          clickable: false,
          zIndex: 10000,
          icon: { path: maps.SymbolPath.CIRCLE, scale: 9, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
        }));
        break;
      case 'click-ns':
        dimOutsideLat(maps, [target.lat >= item.origin.lat ? [item.origin.lat, MAX_LAT] : [-MAX_LAT, item.origin.lat]]);
        break;
      case 'click-ew':
        dimOutsideLng(maps, G.lngDelta(item.origin.lng, target.lng) >= 0 ? item.origin.lng : item.origin.lng - 180, 180);
        break;
      case 'click-near': {
        const near = G.distanceKm(item.origin, target) < NEAR_KM;
        state.hintShapes.push(new maps.Circle({
          map: G.map,
          center: item.origin,
          radius: NEAR_KM * 1000,
          clickable: false,
          strokeColor: color,
          strokeWeight: 2,
          fillColor: near ? color : DIM_COLOR,
          fillOpacity: near ? 0.14 : DIM_OPACITY,
        }));
        break;
      }
      case 'continent':
        state.hintShapes.push(new maps.Rectangle({
          map: G.map,
          bounds: CONTINENT_BOUNDS[item.value],
          clickable: false,
          strokeColor: color,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0.08,
        }));
        break;
      case 'distance':
        state.hintShapes.push(new maps.Circle({
          map: G.map,
          center: item.origin,
          radius: G.distanceKm(item.origin, target) * 1000,
          clickable: false,
          strokeColor: color,
          strokeWeight: 3,
          fillOpacity: 0,
        }));
        break;
      case 'country':
      case 'region':
      case 'county':
        if (item.geometry) drawOutline(maps, item, color);
        break;
      default:
        break;
    }
  }

  function drawHintShapes() {
    clearHintShapes();
    const maps = window.google?.maps;
    if (!maps || !G.map || !G.target || G.mode !== mode) return;
    state.loot.forEach((item) => {
      try {
        drawHint(maps, item, G.target);
      } catch (error) {
        G.log('Fehler beim Zeichnen', item.id, error);
      }
    });
  }

  // ---------- Kisten-Animation ----------

  function createCard(item) {
    const color = TIERS[item.tier].color;
    const card = document.createElement('div');
    card.textContent = item.title;
    card.style.cssText = `flex:0 0 ${CARD_WIDTH}px;height:84px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:8px;text-align:center;font-weight:600;background:#241f4d;border-bottom:5px solid ${color};border-radius:6px;color:#fff`;
    if (item.tier === 'gold' || item.tier === 'fivek') {
      card.style.background = `linear-gradient(180deg,#241f4d 40%,${color}55)`;
      card.style.boxShadow = `inset 0 0 14px ${color}88`;
    }
    return card;
  }

  function removeOverlay() {
    state.overlay?.remove();
    state.overlay = null;
  }

  function spinReel(winner, token) {
    removeOverlay();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;left:50%;top:80px;transform:translateX(-50%);z-index:2147483647;width:min(620px,92vw);padding:12px;box-sizing:border-box;border-radius:12px;background:rgba(15,12,40,.96);color:#fff;font:13px/1.3 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.6);pointer-events:none';

    const reel = document.createElement('div');
    reel.style.cssText = 'position:relative;overflow:hidden;height:84px';
    const strip = document.createElement('div');
    strip.style.cssText = 'display:flex;gap:6px;width:max-content';
    for (let i = 0; i < REEL_LENGTH; i += 1) {
      strip.append(createCard(i === WINNER_INDEX ? winner : rollItem(activeCatalog())));
    }
    const marker = document.createElement('div');
    marker.style.cssText = 'position:absolute;left:50%;top:0;bottom:0;width:3px;margin-left:-1px;background:#fff;box-shadow:0 0 8px #fff';
    reel.append(strip, marker);

    const result = document.createElement('div');
    result.textContent = 'Kiste wird geöffnet...';
    result.style.cssText = 'margin-top:10px;text-align:center;font-size:15px;font-weight:700';
    overlay.append(reel, result);
    document.documentElement.append(overlay);
    state.overlay = overlay;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 0 : SPIN_MS;
    const jitter = (Math.random() - 0.5) * (CARD_WIDTH - 24);
    const offset = WINNER_INDEX * CARD_STEP + CARD_WIDTH / 2 + jitter - reel.clientWidth / 2;
    strip.getBoundingClientRect();
    strip.style.transition = `transform ${duration}ms cubic-bezier(.08,.72,.12,1)`;
    strip.style.transform = `translateX(${-offset}px)`;

    window.setTimeout(() => {
      if (token !== state.spinToken) return;
      const tier = TIERS[winner.tier];
      result.textContent = `${tier.label}: ${winner.title} – ${winner.value}`;
      result.style.color = tier.color;
      state.loot.push(winner);
      if (winner.id === 'arrow') state.arrowOwned = true;
      if (winner.id.startsWith('circle-')) winner.center = offsetPoint(G.target, circleRadiusKm(winner.id));
      if (['country', 'region', 'county'].includes(winner.id)) loadBoundary(winner, G.target);
      drawHintShapes();
      state.spinning = false;
      if (useCoins()) {
        // Turbo erstattet mit Muenzen den Kistenpreis.
        if (winner.id === 'turbo' && state.paid) G.coins.earn(state.paid, 'Turbo');
        state.nextCaseAt = 0;
      } else {
        state.nextCaseAt = winner.id === 'turbo' ? 0 : Date.now() + COOLDOWN_MS[state.variant];
      }
      state.paid = 0;
      if (winner.tier === 'curse') applyCurse(winner, G.roundToken);
      G.render();
      window.setTimeout(() => {
        if (token === state.spinToken) removeOverlay();
      }, RESULT_MS);
    }, duration + 150);
  }

  async function openCase() {
    const target = G.target;
    if (!target || state.spinning || state.exhausted || cooldownSeconds() > 0) return;
    state.paid = 0;
    if (useCoins()) {
      if (!G.coins.spend(PRICE[state.variant], 'Kiste')) return;
      state.paid = PRICE[state.variant];
    }
    state.spinning = true;
    state.message = '';
    state.spinToken += 1;
    const token = state.spinToken;
    G.render();
    if (!state.info) {
      try {
        const info = await G.getInfo();
        if (token !== state.spinToken) return;
        state.info = info;
      } catch {
        if (token !== state.spinToken) return;
        state.spinning = false;
        refundSpin();
        state.message = 'Tipps konnten nicht geladen werden.';
        G.render();
        return;
      }
    }
    const items = availableLoot();
    if (items.length === 0) {
      state.spinning = false;
      state.exhausted = true;
      refundSpin();
      G.render();
      return;
    }
    spinReel(rollItem(items), token);
  }

  function caseLabel(cooldown) {
    if (state.exhausted) return 'Alle Tipps gezogen';
    if (state.spinning) return 'Kiste läuft...';
    if (cooldown > 0) return `Nächste Kiste in ${cooldown} s`;
    if (useCoins()) {
      const price = PRICE[state.variant];
      return G.coins.canAfford(price) ? `Kiste öffnen (${price} 🪙)` : `Zu wenig Münzen (${price} 🪙)`;
    }
    return 'Kiste öffnen';
  }

  function clearRound() {
    state.info = null;
    state.loot = [];
    state.exhausted = false;
    state.spinning = false;
    state.spinToken += 1;
    state.paid = 0;
    state.nextCaseAt = 0;
    state.shownCooldown = 0;
    state.arrowOwned = false;
    state.arrowUsed = false;
    state.shiftGuess = false;
    state.message = '';
    CURSE_EFFECTS.forEach((key) => G.setPanoEffect(key, null));
    clearArrow();
    clearHintShapes();
    removeOverlay();
  }

  const mode = {
    id: 'kiste',
    icon: '🎁',
    name: 'Tipp-Kiste',
    description: 'Öffne Lootboxen mit Hinweisen – von „Kontinent“ bis „exakte Koordinaten“. Achtung, Flüche!',

    stop: clearRound,

    round() {
      clearRound();
    },

    mapReady() {
      drawHintShapes();
    },

    tick() {
      if (state.shownCooldown !== cooldownSeconds()) G.render();
    },

    // Fluch "Guess verrutscht": verschiebt die Koordinaten des naechsten abgeschickten Guess.
    guess(data) {
      if (!state.shiftGuess) return undefined;
      state.shiftGuess = false;
      const shifted = G.destinationPoint(data, CURSE_SHIFT_KM, Math.random() * 2 * Math.PI);
      G.log('Guess verschoben um', CURSE_SHIFT_KM, 'km');
      return { ...data, lat: shifted.lat, lng: shifted.lng };
    },

    render(body) {
      const ui = G.ui;
      if (state.variant === 'crazy') ui.text(body, 'CRAZY', { color: '#ff3b3b', className: 'ggx-center' }).style.fontWeight = '800';

      for (const item of state.loot) {
        ui.text(body, `${item.title}: ${item.value}`, { color: TIERS[item.tier].color });
      }

      if (!G.target || state.message) {
        ui.text(body, state.message || 'Warte auf Rundendaten...');
      } else if (!G.lastClick && !state.exhausted) {
        ui.text(body, 'Vor dem Öffnen auf die Karte klicken – dann sind mehr Tipps möglich.', { className: 'ggx-muted' });
      }

      const cooldown = cooldownSeconds();
      state.shownCooldown = cooldown;
      const broke = useCoins() && !G.coins.canAfford(PRICE[state.variant]);
      ui.button(body, caseLabel(cooldown), openCase, { disabled: !G.target || state.spinning || state.exhausted || cooldown > 0 || broke });

      if (state.arrowOwned) {
        const label = state.arrowUsed ? 'Pfeil verbraucht' : G.lastClick ? 'Pfeil benutzen (1x)' : 'Erst auf Karte klicken';
        ui.button(body, label, useArrow, { disabled: state.arrowUsed || !G.lastClick });
      }

      ui.button(body, state.variant === 'crazy' ? 'Zurück zum Normalmodus' : 'Crazy-Modus aktivieren', () => {
        state.variant = state.variant === 'crazy' ? 'normal' : 'crazy';
        ui.save(VARIANT_KEY, state.variant);
        state.exhausted = false;
        if (useCoins()) {
          G.render();
          return;
        }
        const limit = Date.now() + COOLDOWN_MS[state.variant];
        if (state.nextCaseAt > limit) state.nextCaseAt = limit;
        G.render();
      }, { ghost: true });
    },
  };

  G.registerMode(mode);
})();
