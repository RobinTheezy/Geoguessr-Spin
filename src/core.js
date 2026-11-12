// Kern: Spielerkennung, Netzwerk-/Maps-Hooks, Panorama-Effekte und Modus-Verwaltung.
// Alle Dateien laufen in der MAIN-World und teilen sich das Objekt window.__ggx.
(() => {
  'use strict';

  const PARTY_FLAG = 'gg-handicap-party';
  const MODE_KEY = 'ggx-mode';
  const DEFAULT_MODE = 'kiste';
  const API_PATTERN = /\/api\//;
  // Ein Spiel-ID-Segment: mindestens 8 Zeichen und mindestens eine Ziffer (Lobby-Codes sind kuerzer).
  const ID_SEGMENT = /\/(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{8,}(\/|$)/;
  const originalFetch = window.fetch.bind(window);

  const G = {
    originalFetch,
    modes: [],
    mode: null,
    active: false,
    target: null,
    roundNumber: 0,
    roundToken: 0,
    map: null,
    panorama: null,
    lastClick: null,
    ui: null,
    OriginalWebSocket: window.WebSocket,
  };
  window.__ggx = G;

  // ---------- Globale Hooks (fuer Funktionen, die unabhaengig vom Modus laufen, z. B. Flueche) ----------
  // round(target), active(), inactive(), tick(), guess(data) -> geaenderte Daten oder undefined

  const hooks = { round: [], active: [], inactive: [], tick: [], guess: [] };

  G.on = (name, fn) => {
    hooks[name].push(fn);
  };

  function emit(name, ...args) {
    for (const fn of hooks[name]) {
      try {
        fn(...args);
      } catch (error) {
        G.log('Fehler in Hook', name, error);
      }
    }
  }

  // ---------- Hilfsfunktionen ----------

  G.log = (...args) => console.log('[GG-Spaßmodi]', ...args);

  G.formatNumber = (value) => value.toLocaleString('de-DE', { maximumFractionDigits: 2 });

  G.clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  G.randomFrom = (items) => items[Math.floor(Math.random() * items.length)];

  G.normalizeLng = (lng) => ((lng + 540) % 360) - 180;

  G.lngDelta = (from, to) => {
    let dx = to - from;
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    return dx;
  };

  G.distanceKm = (a, b) => {
    const toRad = (value) => value * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };

  G.destinationPoint = (start, km, bearing) => {
    const toRad = (value) => value * Math.PI / 180;
    const toDeg = (value) => value * 180 / Math.PI;
    const angular = km / 6371;
    const lat1 = toRad(start.lat);
    const lng1 = toRad(start.lng);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: toDeg(lat2), lng: G.normalizeLng(toDeg(lng2)) };
  };

  function mercatorY(lat) {
    const clamped = G.clamp(lat, -85, 85) * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + clamped / 2)) * 180 / Math.PI;
  }

  // Richtung auf der (Mercator-)Karte, damit Pfeile auf dem Bildschirm stimmen.
  G.screenBearing = (from, to) => {
    const dx = G.lngDelta(from.lng, to.lng);
    const dy = mercatorY(to.lat) - mercatorY(from.lat);
    return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  };

  // ---------- Ortsinfos (Nominatim), einmal pro Runde ----------

  let infoPromise = null;

  async function loadInfo(target) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${target.lat}&lon=${target.lng}&zoom=10&accept-language=de`;
    const response = await originalFetch(url);
    const { address = {} } = await response.json();
    return {
      code: address.country_code ?? null,
      country: address.country ?? null,
      region: address.state ?? address.region ?? null,
      county: address.county ?? address.state_district ?? address.city ?? null,
      place: address.village ?? address.town ?? address.city ?? address.municipality ?? address.hamlet ?? null,
    };
  }

  G.getInfo = () => {
    if (!G.target) return Promise.reject(new Error('Kein Ziel'));
    if (!infoPromise) {
      const promise = loadInfo(G.target).catch((error) => {
        if (infoPromise === promise) infoPromise = null;
        throw error;
      });
      infoPromise = promise;
    }
    return infoPromise;
  };

  // ---------- Spielerkennung ----------

  function gamePath() {
    return location.pathname.replace(/^\/[a-z]{2}\//, '/');
  }

  function updatePartyFlag() {
    const path = gamePath();
    if (/^\/party(\/|$)/.test(path)) {
      sessionStorage.setItem(PARTY_FLAG, '1');
    } else if (!ID_SEGMENT.test(path)) {
      sessionStorage.removeItem(PARTY_FLAG);
    }
  }

  // Aktiv nur in Einzelspielen (/game/) und in Spielen, die aus einer privaten Party gestartet wurden.
  function isActive() {
    const path = gamePath();
    if (path.startsWith('/game/')) return true;
    return sessionStorage.getItem(PARTY_FLAG) === '1' && (ID_SEGMENT.test(path) || path.startsWith('/party/'));
  }

  G.isPartyPage = () => gamePath().startsWith('/party/');

  G.inGame = () => G.active && (!G.isPartyPage() || !!G.target);

  // Gemeinsame Spiel-ID fuer Mehrspieler-Spiele (Duelle, Live-Challenge, Battle Royale ...).
  // Einzelspiele (/game/) haben keine Mitspieler und liefern null.
  G.multiplayerGameId = () => {
    const [, type, id] = gamePath().split('/');
    if (!id || type === 'game' || type === 'party' || !ID_SEGMENT.test(`/${id}`)) return null;
    return id;
  };

  // Spiel-ID eines Einzelspiels (/game/<id>), sonst null.
  G.singleGameId = () => {
    const [, type, id] = gamePath().split('/');
    return type === 'game' && id && ID_SEGMENT.test(`/${id}`) ? id : null;
  };

  // ---------- Modus-Verwaltung ----------
  // Ein Modus ist ein Objekt mit id, icon, name, description und optionalen Hooks:
  // start(), stop(), round(target), click(point), mapReady(map), tick(), guess(data), render(body).
  // stop() muss alles aufraeumen, was der Modus angelegt hat.

  function callMode(name, ...args) {
    const mode = G.mode;
    const fn = mode?.[name];
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(mode, args);
    } catch (error) {
      G.log('Fehler in Modus', mode.id, name, error);
      return undefined;
    }
  }

  G.registerMode = (mode) => {
    G.modes.push(mode);
  };

  function readModeId() {
    try {
      return localStorage.getItem(MODE_KEY) ?? DEFAULT_MODE;
    } catch {
      return DEFAULT_MODE;
    }
  }

  function saveModeId(id) {
    try {
      localStorage.setItem(MODE_KEY, id);
    } catch {
      // Auswahl gilt dann nur bis zum Neuladen.
    }
  }

  function startMode() {
    callMode('start');
    if (G.target) callMode('round', G.target);
  }

  function stopMode() {
    callMode('stop');
    // Sicherheitsnetz: alle Effekte des Modus entfernen (globale Effekte mit "global:" bleiben).
    for (const key of [...panoEffects.keys()]) {
      if (!key.startsWith('global:')) panoEffects.delete(key);
    }
    applyPanoEffects();
  }

  G.selectMode = (id) => {
    const next = G.modes.find((mode) => mode.id === id) ?? null;
    if (next === G.mode) return;
    if (G.active) stopMode();
    G.mode = next;
    saveModeId(next?.id ?? 'off');
    G.log('Modus:', next?.id ?? 'aus');
    if (G.active) startMode();
    G.render();
  };

  G.render = () => G.ui?.render();

  // ---------- Runden ----------

  function resetRound() {
    G.target = null;
    G.roundNumber = 0;
    G.lastClick = null;
    G.roundToken += 1;
    infoPromise = null;
  }

  function readTarget(data) {
    if (!data || !Array.isArray(data.rounds) || data.rounds.length === 0) return null;
    const number = data.currentRoundNumber ?? data.round ?? data.rounds.length;
    const round = data.rounds[number - 1] ?? data.rounds[data.rounds.length - 1];
    const location = round.panorama ?? round;
    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;
    return { lat: location.lat, lng: location.lng, number: Number.isInteger(number) ? number : data.rounds.length };
  }

  function findGameData(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 6) return null;
    if (Array.isArray(value.rounds) && readTarget(value)) return value;
    for (const child of Object.values(value)) {
      const found = findGameData(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function acceptGameData(data) {
    if (!isActive()) return;
    const target = readTarget(findGameData(data));
    if (!target) return;
    if (G.target && G.target.lat === target.lat && G.target.lng === target.lng) return;
    resetRound();
    G.target = { lat: target.lat, lng: target.lng };
    G.roundNumber = target.number;
    G.log('Neue Runde', G.roundNumber);
    if (G.active) {
      callMode('round', G.target);
      emit('round', G.target);
    }
    G.render();
  }

  // ---------- Netzwerk-Hooks ----------

  // Gibt dem aktiven Modus die Chance, einen abgeschickten Guess zu sehen oder zu veraendern.
  function transformGuessBody(body) {
    if (!G.active || typeof body !== 'string') return body;
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return body;
    }
    if (!Number.isFinite(data?.lat) || !Number.isFinite(data?.lng)) return body;
    let changed = false;
    for (const fn of hooks.guess) {
      try {
        const result = fn(data);
        if (result) {
          data = result;
          changed = true;
        }
      } catch (error) {
        G.log('Fehler in Hook guess', error);
      }
    }
    const fromMode = callMode('guess', data);
    if (fromMode) {
      data = fromMode;
      changed = true;
    }
    return changed ? JSON.stringify(data) : body;
  }

  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? String(args[0]);
    if (args[1]?.body && API_PATTERN.test(url)) {
      args[1] = { ...args[1], body: transformGuessBody(args[1].body) };
    }
    const response = await originalFetch(...args);
    if (isActive() && API_PATTERN.test(url)) {
      response.clone().json().then(acceptGameData).catch(() => {});
    }
    return response;
  };

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = class extends OriginalWebSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        if (!isActive() || typeof event.data !== 'string' || !event.data.includes('"rounds"')) return;
        try {
          acceptGameData(JSON.parse(event.data));
        } catch {
          // Nachricht ist kein JSON.
        }
      });
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    return originalSend.call(this, this.__ggApi ? transformGuessBody(body) : body);
  };

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ggApi = API_PATTERN.test(String(url));
    if (this.__ggApi) {
      this.addEventListener('load', () => {
        if (!isActive()) return;
        try {
          acceptGameData(JSON.parse(this.responseText));
        } catch {
          // Antwort ist kein JSON.
        }
      });
    }
    return originalOpen.call(this, method, url, ...rest);
  };

  function gameApiUrl() {
    const [, type, id] = gamePath().split('/');
    if (!id) return null;
    if (type === 'game') return `https://www.geoguessr.com/api/v3/games/${id}`;
    if (type === 'duels' || type === 'team-duels') return `https://game-server.geoguessr.com/api/duels/${id}`;
    if (type === 'live-challenge') return `https://game-server.geoguessr.com/api/live-challenge/${id}`;
    return null;
  }

  let lastPoll = 0;
  async function pollGame() {
    const now = Date.now();
    if (now - lastPoll < 4000) return;
    lastPoll = now;
    const url = gameApiUrl();
    if (!url) return;
    try {
      const response = await originalFetch(url, { credentials: 'include' });
      if (response.ok) acceptGameData(await response.json());
    } catch {
      // Beim naechsten Durchlauf erneut versuchen.
    }
  }

  // ---------- Google-Maps-Hooks ----------

  const knownMaps = new WeakSet();
  const MAP_METHODS = ['setOptions', 'setCenter', 'setZoom', 'fitBounds', 'panTo', 'panBy', 'getZoom', 'getCenter', 'getBounds', 'getDiv', 'setMapTypeId'];

  function registerMap(map) {
    if (knownMaps.has(map)) return;
    knownMaps.add(map);
    G.map = map;
    G.log('Karte erkannt');
    window.setTimeout(() => {
      if (G.active) callMode('mapReady', map);
    }, 0);
    map.addListener('click', (event) => {
      if (!G.active || !event.latLng) return;
      G.map = map;
      G.lastClick = { lat: event.latLng.lat(), lng: event.latLng.lng() };
      callMode('click', G.lastClick);
      G.render();
    });
  }

  function hookMaps() {
    const prototype = window.google?.maps?.Map?.prototype;
    if (!prototype || prototype.__ggxHooked) return;
    prototype.__ggxHooked = true;
    for (const name of MAP_METHODS) {
      const original = prototype[name];
      if (typeof original !== 'function') continue;
      prototype[name] = function (...args) {
        registerMap(this);
        return original.apply(this, args);
      };
    }
    G.log('Google Maps gefunden');
  }

  function hookPanorama() {
    const prototype = window.google?.maps?.StreetViewPanorama?.prototype;
    if (!prototype || prototype.__ggxHooked) return;
    prototype.__ggxHooked = true;
    for (const name of ['getPosition', 'setPosition', 'getPov', 'setPov', 'setOptions', 'getZoom', 'setZoom']) {
      const original = prototype[name];
      if (typeof original !== 'function') continue;
      prototype[name] = function (...args) {
        if (G.panorama !== this) {
          G.panorama = this;
          releasePanoElement();
          applyPanoEffects();
        }
        return original.apply(this, args);
      };
    }
  }

  // ---------- Panorama-Effekte ----------
  // Mehrere Quellen koennen gleichzeitig Effekte setzen; sie werden zusammengesetzt.
  // Effekt: { filter?, transform?, mask?, underlay? } (underlay = Hintergrundfarbe hinter dem Panorama).

  const panoEffects = new Map();
  let panoElement = null;

  // Panorama-Element: bevorzugt das Street-View-Div, sonst die groesste Canvas ausserhalb der Guess-Karte.
  function findPanoElement() {
    const fromPanorama = G.panorama?.getDiv?.();
    if (fromPanorama?.isConnected) return fromPanorama;
    const mapDiv = G.map?.getDiv?.();
    let best = null;
    let bestArea = 0;
    for (const canvas of document.querySelectorAll('canvas')) {
      if (mapDiv?.contains(canvas)) continue;
      const { width, height } = canvas.getBoundingClientRect();
      if (width * height > bestArea) {
        best = canvas.parentElement;
        bestArea = width * height;
      }
    }
    return best;
  }

  function releasePanoElement() {
    if (!panoElement) return;
    const { style, parentElement } = panoElement;
    style.filter = '';
    style.transform = '';
    style.maskImage = '';
    style.webkitMaskImage = '';
    if (parentElement) parentElement.style.backgroundColor = '';
    panoElement = null;
  }

  function applyPanoEffects() {
    const wanted = panoEffects.size > 0 && G.active;
    const element = wanted ? (panoElement?.isConnected ? panoElement : findPanoElement()) : null;
    if (panoElement !== element) releasePanoElement();
    if (!element) return;
    panoElement = element;
    const filters = [];
    const transforms = [];
    let mask = '';
    let underlay = '';
    for (const effect of panoEffects.values()) {
      if (effect.filter) filters.push(effect.filter);
      if (effect.transform) transforms.push(effect.transform);
      if (effect.mask) mask = effect.mask;
      if (effect.underlay) underlay = effect.underlay;
    }
    element.style.filter = filters.join(' ');
    element.style.transform = transforms.join(' ');
    element.style.maskImage = mask;
    element.style.webkitMaskImage = mask;
    if (element.parentElement) element.parentElement.style.backgroundColor = underlay;
  }

  G.setPanoEffect = (key, effect) => {
    if (effect) panoEffects.set(key, effect);
    else panoEffects.delete(key);
    applyPanoEffects();
  };

  G.getPanoElement = () => (panoElement?.isConnected ? panoElement : findPanoElement());

  // ---------- Hauptschleife ----------

  function tick() {
    updatePartyFlag();
    const active = isActive();
    if (active !== G.active) {
      G.active = active;
      G.log(active ? 'Aktiv auf' : 'Inaktiv auf', location.pathname);
      if (active) {
        startMode();
        emit('active');
      } else {
        stopMode();
        emit('inactive');
        panoEffects.clear();
        applyPanoEffects();
        resetRound();
      }
      G.render();
    }
    if (active) {
      pollGame();
      if (panoEffects.size > 0 && !panoElement?.isConnected) applyPanoEffects();
      callMode('tick');
      emit('tick');
    }
    G.ui?.ensure();
  }

  G.start = () => {
    const id = readModeId();
    G.mode = G.modes.find((mode) => mode.id === id) ?? null;
    updatePartyFlag();
    window.setInterval(() => {
      hookMaps();
      hookPanorama();
    }, 20);
    window.setInterval(tick, 500);
    G.render();
  };
})();
