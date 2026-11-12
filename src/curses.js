// Flueche verschicken: In Mehrspieler-Spielen aus einer Party verbinden sich alle Spieler mit der
// Erweiterung ueber den Fluch-Server (Cloudflare Worker) und koennen sich gegenseitig verfluchen.
// Laeuft unabhaengig vom gewaehlten Modus.
(() => {
  'use strict';

  const G = window.__ggx;

  // Adresse des Fluch-Servers. Ueberschreibbar per localStorage 'ggx-fluch-server' (z. B. zum lokalen Testen).
  const DEFAULT_SERVER = 'wss://geoguessr-fluch.autodarts-minigames.workers.dev/room';
  const SERVER_KEY = 'ggx-fluch-server';
  const ENABLED_KEY = 'ggx-fluch-enabled';
  const IDENTITY_KEY = 'ggx-fluch-identity';
  const CHARGES_PER_ROUND = 1;
  const SHIFT_KM = 30;
  const RECONNECT_MS = [1000, 2000, 5000, 10000, 20000];

  // Uebungsmodus fuer Einzelspiele: ein Test-Bot verbindet sich als zweiter Spieler ueber den echten Server.
  const PRACTICE_KEY = 'ggx-fluch-practice';
  const BOT_NAME = '🤖 Bot Bernd';
  const BOT_DELAY_MS = [15000, 40000];
  const BOT_REACTIONS = ['Aua!', 'Na warte …', 'Das gibt Rache!', 'Ich seh nix mehr!', 'Unfair!', 'Haha, guter Fluch.'];

  const HIDE_LABELS = [{ elementType: 'labels', stylers: [{ visibility: 'off' }] }];

  // pano: Panorama-Effekt · keyhole: Lichtkegel · labels: Karte ohne Namen · shift: naechster Guess verrutscht
  const CURSES = {
    upside: { icon: '🙃', name: 'Kopfstand', seconds: 20, pano: { transform: 'rotate(180deg)' } },
    mirror: { icon: '🪞', name: 'Spiegel', seconds: 30, pano: { transform: 'scaleX(-1)' } },
    invert: { icon: '🌈', name: 'Invertiert', seconds: 30, pano: { filter: 'invert(1)' } },
    blur: { icon: '🌫️', name: 'Nebelwand', seconds: 20, pano: { filter: 'blur(10px)' } },
    blackout: { icon: '🌑', name: 'Stromausfall', seconds: 8, pano: { filter: 'brightness(0)' } },
    gray: { icon: '🐼', name: 'Schwarzweiß', seconds: 45, pano: { filter: 'grayscale(1)' } },
    keyhole: { icon: '🔦', name: 'Schlüsselloch', seconds: 25, keyhole: true },
    labels: { icon: '🗺️', name: 'Blinde Karte', seconds: 45, labels: true },
    shift: { icon: '🫨', name: 'Wackelhand', note: `nächster Guess ${SHIFT_KM} km daneben`, shift: true },
  };

  const state = {
    enabled: G.ui.load(ENABLED_KEY, '1') === '1',
    practice: readPractice(),
    bot: null, // { socket, id, timer, plannedRound }
    botAuto: true,
    identity: null,
    socket: null,
    room: null,
    connected: false,
    retry: 0,
    retryTimer: 0,
    players: [],
    // Senden
    chargesRound: 0,
    chargesUsed: 0,
    selectedTarget: null,
    selectedCurse: 'upside',
    feedback: '',
    // Empfangen
    active: new Map(), // id -> { until, timer }
    shiftGuess: false,
    shownSeconds: '',
    mouse: null,
    frame: 0,
    mapOriginal: undefined,
    styledMap: null,
  };

  function readPractice() {
    try {
      return sessionStorage.getItem(PRACTICE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function savePractice(value) {
    state.practice = value;
    try {
      if (value) sessionStorage.setItem(PRACTICE_KEY, '1');
      else sessionStorage.removeItem(PRACTICE_KEY);
    } catch {
      // Gilt dann nur bis zum Neuladen.
    }
  }

  function isPractice() {
    return state.practice && !G.multiplayerGameId() && !!G.singleGameId();
  }

  // ---------- Identitaet ----------

  async function loadIdentity() {
    if (state.identity) return state.identity;
    try {
      const response = await G.originalFetch('https://www.geoguessr.com/api/v3/profiles', { credentials: 'include' });
      if (response.ok) {
        const { user } = await response.json();
        if (user?.id) {
          state.identity = { id: String(user.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64), name: user.nick || 'Spieler' };
          return state.identity;
        }
      }
    } catch {
      // Fallback unten.
    }
    let fallback = null;
    try {
      fallback = JSON.parse(G.ui.load(IDENTITY_KEY, 'null'));
    } catch {
      fallback = null;
    }
    if (!fallback?.id) {
      fallback = { id: `anon-${Math.random().toString(36).slice(2, 10)}`, name: 'Spieler' };
      G.ui.save(IDENTITY_KEY, JSON.stringify(fallback));
    }
    state.identity = fallback;
    return fallback;
  }

  // ---------- Verbindung ----------

  function serverUrl() {
    return G.ui.load(SERVER_KEY, DEFAULT_SERVER);
  }

  function wantedRoom() {
    if (!state.enabled || !G.active) return null;
    const multiplayer = G.multiplayerGameId();
    if (multiplayer) return multiplayer;
    return isPractice() ? `solo-${G.singleGameId()}` : null;
  }

  function disconnect() {
    window.clearTimeout(state.retryTimer);
    state.retryTimer = 0;
    const socket = state.socket;
    state.socket = null;
    state.room = null;
    state.connected = false;
    state.players = [];
    if (socket) {
      socket.onclose = null;
      try {
        socket.close(1000);
      } catch {
        // Schon zu.
      }
    }
  }

  async function connect(room) {
    disconnect();
    state.room = room;
    const identity = await loadIdentity();
    if (state.room !== room) return;
    const url = `${serverUrl()}?room=${encodeURIComponent(room)}&id=${encodeURIComponent(identity.id)}&name=${encodeURIComponent(identity.name)}`;
    let socket;
    try {
      socket = new G.OriginalWebSocket(url);
    } catch (error) {
      G.log('Fluch-Server nicht erreichbar', error);
      scheduleReconnect(room);
      return;
    }
    state.socket = socket;
    socket.onopen = () => {
      state.connected = true;
      state.retry = 0;
      G.log('Mit Fluch-Server verbunden, Raum', room);
      G.render();
    };
    socket.onmessage = (event) => {
      try {
        handleMessage(JSON.parse(event.data));
      } catch (error) {
        G.log('Ungültige Nachricht vom Fluch-Server', error);
      }
    };
    socket.onclose = () => {
      if (state.socket !== socket) return;
      state.socket = null;
      state.connected = false;
      state.players = [];
      G.render();
      scheduleReconnect(room);
    };
  }

  function scheduleReconnect(room) {
    window.clearTimeout(state.retryTimer);
    const delay = RECONNECT_MS[Math.min(state.retry, RECONNECT_MS.length - 1)];
    state.retry += 1;
    state.retryTimer = window.setTimeout(() => {
      if (wantedRoom() === room && !state.socket) connect(room);
    }, delay);
  }

  function syncConnection() {
    const room = wantedRoom();
    if (room === state.room) return;
    if (room) connect(room);
    else disconnect();
    G.render();
  }

  // ---------- Test-Bot ----------

  function botWanted() {
    return isPractice() && !!state.room && state.room === wantedRoom();
  }

  function startBot() {
    stopBot();
    const id = `bot-${Math.random().toString(36).slice(2, 10)}`;
    const url = `${serverUrl()}?room=${encodeURIComponent(state.room)}&id=${id}&name=${encodeURIComponent(BOT_NAME)}`;
    let socket;
    try {
      socket = new G.OriginalWebSocket(url);
    } catch {
      return;
    }
    const bot = { socket, id, timer: 0, plannedRound: 0 };
    state.bot = bot;
    socket.onopen = () => G.render();
    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type !== 'curse') return;
      const curse = CURSES[message.curse];
      G.ui.toast(`${BOT_NAME}: „${G.randomFrom(BOT_REACTIONS)}“ – ${curse?.icon ?? ''} ${curse?.name ?? 'Fluch'} wirkt bei ihm`, 3000);
    };
    socket.onclose = () => {
      if (state.bot !== bot) return;
      window.clearTimeout(bot.timer);
      state.bot = null; // Der naechste Tick verbindet neu.
      G.render();
    };
  }

  function stopBot() {
    const bot = state.bot;
    if (!bot) return;
    state.bot = null;
    window.clearTimeout(bot.timer);
    bot.socket.onclose = null;
    try {
      bot.socket.close(1000);
    } catch {
      // Schon zu.
    }
  }

  function botReady() {
    return state.bot?.socket.readyState === 1 && !!state.identity && !!G.roundNumber;
  }

  function botCurse() {
    if (!botReady()) return;
    const id = G.randomFrom(Object.keys(CURSES));
    state.bot.socket.send(JSON.stringify({ type: 'curse', to: state.identity.id, curse: id, round: G.roundNumber }));
  }

  // Einmal pro Runde greift der Bot nach einer zufaelligen Wartezeit von selbst an.
  function planBotCurse() {
    const bot = state.bot;
    if (!bot || !state.botAuto || !G.roundNumber || bot.plannedRound === G.roundNumber) return;
    const round = G.roundNumber;
    bot.plannedRound = round;
    window.clearTimeout(bot.timer);
    const [min, max] = BOT_DELAY_MS;
    bot.timer = window.setTimeout(() => {
      if (state.bot === bot && state.botAuto && G.roundNumber === round) botCurse();
    }, min + Math.random() * (max - min));
  }

  function syncBot() {
    if (botWanted()) {
      if (!state.bot) startBot();
      else planBotCurse();
    } else if (state.bot) {
      stopBot();
    }
  }

  function others() {
    return state.players.filter((player) => player.id !== state.identity?.id);
  }

  function handleMessage(message) {
    switch (message.type) {
      case 'players': {
        state.players = Array.isArray(message.players) ? message.players : [];
        const list = others();
        if (!list.some((player) => player.id === state.selectedTarget)) state.selectedTarget = list[0]?.id ?? null;
        G.render();
        break;
      }
      case 'curse':
        receiveCurse(message);
        break;
      case 'delivered': {
        const curse = CURSES[message.curse];
        const target = state.players.find((player) => player.id === message.to)?.name ?? 'Mitspieler';
        state.feedback = message.ok ? `✔ ${curse?.name ?? 'Fluch'} an ${target} geschickt` : `${target} ist nicht mehr da`;
        if (!message.ok) state.chargesUsed = Math.max(0, state.chargesUsed - 1);
        G.render();
        break;
      }
      case 'error':
        state.feedback = String(message.reason ?? 'Fehler');
        state.chargesUsed = Math.max(0, state.chargesUsed - 1);
        G.render();
        break;
      default:
        break;
    }
  }

  // ---------- Senden ----------

  function chargesLeft() {
    if (isPractice()) return Infinity;
    if (state.chargesRound !== G.roundNumber) {
      state.chargesRound = G.roundNumber;
      state.chargesUsed = 0;
    }
    return Math.max(0, CHARGES_PER_ROUND - state.chargesUsed);
  }

  function sendCurse() {
    if (!state.connected || !state.selectedTarget || !G.roundNumber || chargesLeft() <= 0) return;
    state.chargesUsed += 1;
    state.feedback = 'Wird zugestellt …';
    state.socket.send(JSON.stringify({ type: 'curse', to: state.selectedTarget, curse: state.selectedCurse, round: G.roundNumber }));
    G.render();
  }

  // ---------- Empfangen ----------

  function receiveCurse(message) {
    const curse = CURSES[message.curse];
    if (!curse || !G.active) return;
    // Fluch aus einer anderen Runde (z. B. kam zu spaet an) verpufft.
    if (message.round !== G.roundNumber) return;
    const from = String(message.from?.name ?? 'Jemand').slice(0, 24);
    G.ui.toast(`😈 ${from} verflucht dich: ${curse.icon} ${curse.name}${curse.seconds ? ` (${curse.seconds} s)` : ` – ${curse.note}`}`);
    applyCurse(message.curse, curse);
    G.render();
  }

  function applyCurse(id, curse) {
    if (curse.shift) {
      state.shiftGuess = true;
      return;
    }
    const existing = state.active.get(id);
    if (existing) window.clearTimeout(existing.timer);
    const until = Date.now() + curse.seconds * 1000;
    const timer = window.setTimeout(() => endCurse(id), curse.seconds * 1000);
    state.active.set(id, { until, timer });
    if (curse.pano) G.setPanoEffect(`global:fluch-${id}`, curse.pano);
    if (curse.keyhole) startKeyhole();
    if (curse.labels) applyLabels();
  }

  function endCurse(id) {
    const entry = state.active.get(id);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    state.active.delete(id);
    const curse = CURSES[id];
    if (curse.pano) G.setPanoEffect(`global:fluch-${id}`, null);
    if (curse.keyhole) stopKeyhole();
    if (curse.labels) restoreLabels();
    G.render();
  }

  function clearAllCurses() {
    for (const id of [...state.active.keys()]) endCurse(id);
    state.shiftGuess = false;
  }

  // Lichtkegel um die Maus (wie der Modus "Schluesselloch", nur befristet).
  function updateKeyhole() {
    state.frame = 0;
    if (!state.active.has('keyhole')) return;
    const element = G.getPanoElement();
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = state.mouse ? state.mouse.x - rect.left : rect.width / 2;
    const y = state.mouse ? state.mouse.y - rect.top : rect.height / 2;
    G.setPanoEffect('global:fluch-keyhole', {
      mask: `radial-gradient(circle 90px at ${x}px ${y}px, #000 74px, transparent 90px)`,
      underlay: '#05040f',
    });
  }

  function onMove(event) {
    state.mouse = { x: event.clientX, y: event.clientY };
    if (!state.frame) state.frame = window.requestAnimationFrame(updateKeyhole);
  }

  function startKeyhole() {
    window.addEventListener('pointermove', onMove, true);
    updateKeyhole();
  }

  function stopKeyhole() {
    window.removeEventListener('pointermove', onMove, true);
    if (state.frame) window.cancelAnimationFrame(state.frame);
    state.frame = 0;
    G.setPanoEffect('global:fluch-keyhole', null);
  }

  // Karte ohne Namen. Im Modus "Blinde Karte" ist die Karte ohnehin schon blind.
  function applyLabels() {
    const map = G.map;
    if (!map || G.mode?.id === 'blindmap' || map.get('styles') === HIDE_LABELS) return;
    if (state.styledMap !== map) {
      restoreLabels();
      state.styledMap = map;
      state.mapOriginal = map.get('styles') ?? null;
    }
    map.setOptions({ styles: HIDE_LABELS });
  }

  function restoreLabels() {
    if (state.styledMap && G.mode?.id !== 'blindmap') state.styledMap.setOptions({ styles: state.mapOriginal });
    state.styledMap = null;
    state.mapOriginal = undefined;
  }

  // ---------- Panel ----------

  function secondsLeft(entry) {
    return Math.max(0, Math.ceil((entry.until - Date.now()) / 1000));
  }

  function activeSummary() {
    return [...state.active.entries()].map(([id, entry]) => `${CURSES[id].icon} ${CURSES[id].name} ${secondsLeft(entry)} s`).join(' · ');
  }

  function renderPracticeControls(body) {
    const ui = G.ui;
    ui.text(body, 'Übungsmodus mit Test-Bot', { className: 'ggx-muted' });
    ui.button(body, botReady() ? '🤖 Bot soll mich jetzt verfluchen' : '🤖 Bot verbindet …', botCurse, { disabled: !botReady() });
    ui.choice(body, [{ id: 'on', label: 'Bot greift an' }, { id: 'off', label: 'Bot friedlich' }], state.botAuto ? 'on' : 'off', (id) => {
      state.botAuto = id === 'on';
      if (state.bot) {
        window.clearTimeout(state.bot.timer);
        state.bot.plannedRound = 0;
      }
      G.render();
    });
    ui.button(body, 'Übung beenden', () => {
      savePractice(false);
      stopBot();
      syncConnection();
    }, { ghost: true });
  }

  function render(body) {
    const multiplayer = G.multiplayerGameId();
    if (!multiplayer && !G.singleGameId()) return;
    const ui = G.ui;
    ui.text(body, '😈 Flüche', { className: 'ggx-section-title' });

    if (!multiplayer && !state.practice) {
      ui.text(body, 'Im Einzelspiel gibt es keine Mitspieler – aber einen Test-Bot zum Üben.', { className: 'ggx-muted' });
      ui.button(body, '🤖 Mit Test-Bot üben', () => {
        savePractice(true);
        if (!state.enabled) {
          state.enabled = true;
          ui.save(ENABLED_KEY, '1');
        }
        syncConnection();
      }, { ghost: true });
      return;
    }

    if (!state.enabled) {
      ui.button(body, 'Flüche einschalten', () => {
        state.enabled = true;
        ui.save(ENABLED_KEY, '1');
        syncConnection();
      }, { ghost: true });
      return;
    }

    const summary = activeSummary();
    state.shownSeconds = summary;
    if (summary) ui.text(body, `Auf dir: ${summary}`, { color: '#ff7aa8' });
    if (state.shiftGuess) ui.text(body, `🫨 Dein nächster Guess landet ${SHIFT_KM} km daneben`, { color: '#ff7aa8' });

    if (!state.connected) {
      if (isPractice()) renderPracticeControls(body);
      ui.text(body, state.retry > 1 ? 'Fluch-Server nicht erreichbar – versuche es weiter …' : 'Verbinde …', { className: 'ggx-muted' });
      return;
    }
    const list = others();
    if (list.length === 0) {
      ui.text(body, isPractice() ? 'Bot kommt gleich …' : 'Noch keine Mitspieler mit der Erweiterung im Spiel.', { className: 'ggx-muted' });
      if (isPractice()) renderPracticeControls(body);
      return;
    }

    ui.text(body, 'Opfer:', { className: 'ggx-muted' });
    ui.choice(body, list.map((player) => ({ id: player.id, label: player.name })), state.selectedTarget, (id) => {
      state.selectedTarget = id;
      G.render();
    }, { grid: list.length > 3 });

    const options = Object.entries(CURSES).map(([id, curse]) => ({ id, label: `${curse.icon} ${curse.name}` }));
    ui.choice(body, options, state.selectedCurse, (id) => {
      state.selectedCurse = id;
      G.render();
    }, { grid: true });
    const selected = CURSES[state.selectedCurse];
    ui.text(body, selected.seconds ? `${selected.seconds} Sekunden` : selected.note, { className: 'ggx-muted ggx-center' });

    const left = chargesLeft();
    const label = left === Infinity ? 'Fluch schicken' : left > 0 ? `Fluch schicken (${left} übrig)` : 'Diese Runde schon verflucht';
    ui.button(body, label, sendCurse, { disabled: left <= 0 || !state.selectedTarget || !G.roundNumber });
    if (state.feedback) ui.text(body, state.feedback, { className: 'ggx-muted' });
    if (isPractice()) renderPracticeControls(body);
  }

  // ---------- Verdrahtung ----------

  G.ui.addSection({ render });

  G.on('active', syncConnection);

  G.on('inactive', () => {
    clearAllCurses();
    stopBot();
    syncConnection();
  });

  G.on('round', () => {
    clearAllCurses();
    state.feedback = '';
    syncConnection();
  });

  G.on('tick', () => {
    syncConnection();
    syncBot();
    if (state.active.has('labels')) applyLabels();
    if (state.active.has('keyhole')) updateKeyhole();
    if (state.shownSeconds !== activeSummary()) G.render();
  });

  G.on('guess', (data) => {
    if (!state.shiftGuess) return undefined;
    state.shiftGuess = false;
    const shifted = G.destinationPoint(data, SHIFT_KM, Math.random() * 2 * Math.PI);
    return { ...data, lat: shifted.lat, lng: shifted.lng };
  });
})();
