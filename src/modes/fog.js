// Modus "Nebel": Das Panorama startet komplett verschwommen und klart langsam auf.
// Gemessen wird, bei wie viel Prozent Sicht du getippt hast – je weniger, desto mehr Ruhm.
(() => {
  'use strict';

  const G = window.__ggx;

  const SPEED_KEY = 'ggx-fog-speed';
  const SPEEDS = [
    { id: '45', label: '45 s', ms: 45000 },
    { id: '90', label: '90 s', ms: 90000 },
    { id: '180', label: '3 min', ms: 180000 },
  ];
  const START_BLUR_PX = 28;

  const state = {
    speed: G.ui.load(SPEED_KEY, '90'),
    startedAt: Date.now(),
    timer: 0,
    guessedAt: null,
    shownPercent: -1,
    history: [],
  };

  function durationMs() {
    return (SPEEDS.find((speed) => speed.id === state.speed) ?? SPEEDS[1]).ms;
  }

  function visibility() {
    return G.clamp((Date.now() - state.startedAt) / durationMs(), 0, 1);
  }

  function apply() {
    const fog = 1 - visibility();
    if (fog <= 0) {
      G.setPanoEffect('fog', null);
      return;
    }
    const blur = START_BLUR_PX * fog ** 1.6;
    G.setPanoEffect('fog', {
      filter: `blur(${blur.toFixed(1)}px) grayscale(${fog.toFixed(2)}) brightness(${(1 + 0.45 * fog).toFixed(2)}) contrast(${(1 - 0.45 * fog).toFixed(2)})`,
    });
  }

  function percent(value) {
    return Math.round(value * 100);
  }

  G.registerMode({
    id: 'fog',
    icon: '🌫️',
    name: 'Nebel',
    description: 'Das Bild startet total verschwommen und klart langsam auf. Wer traut sich, bei wenig Sicht zu tippen?',

    start() {
      state.startedAt = Date.now();
      state.timer = window.setInterval(apply, 200);
      apply();
    },

    stop() {
      window.clearInterval(state.timer);
      state.timer = 0;
      G.setPanoEffect('fog', null);
    },

    round() {
      if (state.guessedAt !== null) state.history = [state.guessedAt, ...state.history].slice(0, 5);
      state.startedAt = Date.now();
      state.guessedAt = null;
      apply();
    },

    tick() {
      if (state.shownPercent !== percent(visibility())) G.render();
    },

    guess() {
      if (state.guessedAt === null && G.target) {
        state.guessedAt = visibility();
        G.render();
      }
      return undefined;
    },

    render(body) {
      const ui = G.ui;
      const shown = percent(visibility());
      state.shownPercent = shown;
      ui.text(body, `Sicht: ${shown} %`, { className: 'ggx-big' });
      ui.bar(body, shown / 100, '#9fd8ff');
      if (state.guessedAt !== null) {
        ui.text(body, `Getippt bei ${percent(state.guessedAt)} % Sicht`, { className: 'ggx-center', color: '#ffd21f' });
      } else {
        ui.text(body, 'Je früher du tippst, desto mehr Ruhm.', { className: 'ggx-muted' });
      }
      if (state.history.length > 0) {
        ui.text(body, `Letzte Runden: ${state.history.map((value) => `${percent(value)} %`).join(' · ')}`, { className: 'ggx-muted' });
      }
      ui.text(body, 'Klare Sicht nach:', { className: 'ggx-muted' });
      ui.choice(body, SPEEDS, state.speed, (id) => {
        // Fortschritt beibehalten, nur das Tempo aendern.
        const progress = visibility();
        state.speed = id;
        ui.save(SPEED_KEY, id);
        state.startedAt = Date.now() - progress * durationMs();
        apply();
        G.render();
      });
    },
  });
})();
