// Modus "Filter-Roulette": Jede Runde bekommt das Panorama einen zufaelligen Bildfilter.
(() => {
  'use strict';

  const G = window.__ggx;

  const FILTERS = [
    { name: 'Schwarzweiß', note: 'Farben? Überbewertet.', filter: 'grayscale(1)' },
    { name: 'Wärmebild', note: 'Wie in einem Actionfilm.', filter: 'invert(1) hue-rotate(180deg) saturate(2.5)' },
    { name: 'Altes Foto', note: 'Opas Urlaubsdias.', filter: 'sepia(1) contrast(1.15) brightness(.9)' },
    { name: 'Kopfstand', note: 'Die Welt steht kopf – auch beim Umsehen.', transform: 'rotate(180deg)' },
    { name: 'Spiegelwelt', note: 'Linksverkehr oder Rechtsverkehr?', transform: 'scaleX(-1)' },
    { name: 'Neon', note: 'Augenkrebs inklusive.', filter: 'saturate(5) contrast(1.6)' },
    { name: 'Waschküche', note: 'Irgendwo da draußen ist ein Land.', filter: 'contrast(.35) brightness(1.35) blur(1.5px)' },
    { name: 'Nachtsicht', note: 'Grün, grüner, Nachtsichtgerät.', filter: 'grayscale(1) sepia(1) hue-rotate(60deg) saturate(4) brightness(1.1) contrast(1.3)' },
    { name: 'Röntgen', note: 'Durchleuchtet bis auf die Knochen.', filter: 'grayscale(1) invert(1) contrast(1.4)' },
    { name: 'Disco', note: 'Die Farben tanzen.', disco: true },
  ];

  const state = { current: null, rerolled: false, timer: 0, hue: 0 };

  function apply() {
    window.clearInterval(state.timer);
    state.timer = 0;
    const current = state.current;
    if (!current) {
      G.setPanoEffect('roulette', null);
      return;
    }
    if (current.disco) {
      state.timer = window.setInterval(() => {
        state.hue = (state.hue + 9) % 360;
        G.setPanoEffect('roulette', { filter: `hue-rotate(${state.hue}deg) saturate(2.2)` });
      }, 60);
      return;
    }
    G.setPanoEffect('roulette', { filter: current.filter, transform: current.transform });
  }

  function pick() {
    state.current = G.randomFrom(FILTERS.filter((filter) => filter !== state.current));
    apply();
  }

  G.registerMode({
    id: 'filters',
    icon: '🎨',
    name: 'Filter-Roulette',
    description: 'Jede Runde ein zufälliger Bildfilter: Kopfstand, Wärmebild, Röntgen, Disco …',

    start: pick,

    stop() {
      state.current = null;
      apply();
    },

    round() {
      state.rerolled = false;
      pick();
    },

    render(body) {
      const ui = G.ui;
      if (!state.current) return;
      ui.text(body, state.current.name, { className: 'ggx-big' });
      ui.text(body, state.current.note, { className: 'ggx-muted ggx-center' });
      ui.button(body, state.rerolled ? 'Schon neu gewürfelt' : 'Neu würfeln (1x pro Runde)', () => {
        state.rerolled = true;
        pick();
        G.render();
      }, { disabled: state.rerolled });
    },
  });
})();
