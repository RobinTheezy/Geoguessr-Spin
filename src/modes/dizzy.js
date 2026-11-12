// Modus "Schwindel": Das Panorama schwankt, verschwimmt und die Blickrichtung driftet.
(() => {
  'use strict';

  const G = window.__ggx;

  const LEVEL_KEY = 'ggx-dizzy-level';
  const FRAME_MS = 40;
  // angle = max. Neigung in Grad, blur = max. Unschaerfe in px, drift = Grad pro Sekunde
  const LEVELS = [
    { id: 'light', label: 'Beschwipst', angle: 3, blur: 1, drift: 4 },
    { id: 'medium', label: 'Betrunken', angle: 7, blur: 2.5, drift: 10 },
    { id: 'hard', label: 'Seekrank', angle: 12, blur: 4, drift: 22 },
  ];

  const state = {
    level: G.ui.load(LEVEL_KEY, 'medium'),
    timer: 0,
    startedAt: 0,
    lastFrame: 0,
    scale: 1.3,
  };

  function currentLevel() {
    return LEVELS.find((level) => level.id === state.level) ?? LEVELS[1];
  }

  // Skalierung, damit beim Drehen keine leeren Ecken sichtbar werden.
  function updateScale() {
    const rect = G.getPanoElement()?.getBoundingClientRect();
    const ratio = rect?.height ? Math.max(rect.width / rect.height, rect.height / rect.width) : 16 / 9;
    const angle = currentLevel().angle * Math.PI / 180;
    state.scale = Math.cos(angle) + ratio * Math.sin(angle);
  }

  function drift(level, t, dt) {
    const panorama = G.panorama;
    if (!panorama?.getPov) return;
    try {
      const pov = panorama.getPov();
      panorama.setPov({ heading: pov.heading + level.drift * dt * Math.sin(t * 0.3), pitch: pov.pitch });
    } catch {
      // Panorama nicht bereit.
    }
  }

  function frame() {
    const level = currentLevel();
    const now = Date.now();
    const t = (now - state.startedAt) / 1000;
    const dt = Math.min(0.2, (now - state.lastFrame) / 1000);
    state.lastFrame = now;
    const angle = level.angle * (0.75 * Math.sin(t * 0.8) + 0.25 * Math.sin(t * 2.1));
    const blur = level.blur * Math.max(0, Math.sin(t * 0.45));
    G.setPanoEffect('dizzy', {
      transform: `rotate(${angle.toFixed(2)}deg) scale(${state.scale.toFixed(3)})`,
      filter: `blur(${blur.toFixed(2)}px)`,
    });
    drift(level, t, dt);
  }

  G.registerMode({
    id: 'dizzy',
    icon: '🍺',
    name: 'Schwindel',
    description: 'Das Bild schwankt, verschwimmt und dreht sich von selbst weg. Nichts für schwache Mägen.',

    start() {
      state.startedAt = Date.now();
      state.lastFrame = state.startedAt;
      updateScale();
      state.timer = window.setInterval(frame, FRAME_MS);
    },

    stop() {
      window.clearInterval(state.timer);
      state.timer = 0;
      G.setPanoEffect('dizzy', null);
    },

    tick: updateScale,

    render(body) {
      G.ui.choice(body, LEVELS, state.level, (id) => {
        state.level = id;
        G.ui.save(LEVEL_KEY, id);
        updateScale();
        G.render();
      });
    },
  });
})();
