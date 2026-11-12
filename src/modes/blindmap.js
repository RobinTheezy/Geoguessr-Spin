// Modus "Blinde Karte": Die Guess-Karte verliert Beschriftungen, Grenzen und Strassen.
(() => {
  'use strict';

  const G = window.__ggx;

  const LEVEL_KEY = 'ggx-blindmap-level';
  const HIDE = (featureType) => ({ featureType, stylers: [{ visibility: 'off' }] });

  const LEVELS = [
    {
      id: 'names',
      label: 'Ohne Namen',
      note: 'Keine Orts-, Länder- oder Straßennamen.',
      styles: [{ elementType: 'labels', stylers: [{ visibility: 'off' }] }],
    },
    {
      id: 'coast',
      label: 'Nur Küsten',
      note: 'Nur noch Land und Wasser – keine Grenzen, keine Straßen.',
      styles: [
        { elementType: 'labels', stylers: [{ visibility: 'off' }] },
        HIDE('administrative'),
        HIDE('road'),
        HIDE('poi'),
        HIDE('transit'),
        { featureType: 'landscape', stylers: [{ color: '#e6e1d3' }] },
        { featureType: 'water', stylers: [{ color: '#8db6d6' }] },
      ],
    },
  ];

  const state = {
    level: G.ui.load(LEVEL_KEY, 'names'),
    originals: new Map(),
  };

  function currentLevel() {
    return LEVELS.find((level) => level.id === state.level) ?? LEVELS[0];
  }

  function apply() {
    const map = G.map;
    if (!map) return;
    const { styles } = currentLevel();
    if (map.get('styles') === styles) return;
    if (!state.originals.has(map)) state.originals.set(map, map.get('styles') ?? null);
    map.setOptions({ styles });
  }

  function restore() {
    for (const [map, styles] of state.originals) map.setOptions({ styles });
    state.originals.clear();
  }

  G.registerMode({
    id: 'blindmap',
    icon: '🗺️',
    name: 'Blinde Karte',
    description: 'Die Guess-Karte ohne Namen – oder nur noch mit Küstenlinien. Wo ist eigentlich Belgien?',

    start: apply,
    stop: restore,
    mapReady: apply,
    tick: apply,

    render(body) {
      G.ui.choice(body, LEVELS, state.level, (id) => {
        state.level = id;
        G.ui.save(LEVEL_KEY, id);
        apply();
        G.render();
      });
      G.ui.text(body, currentLevel().note, { className: 'ggx-muted' });
    },
  });
})();
