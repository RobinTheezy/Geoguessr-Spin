// Modus "Schlüsselloch": Vom Panorama ist nur ein Kreis um den Mauszeiger sichtbar.
(() => {
  'use strict';

  const G = window.__ggx;

  const SIZE_KEY = 'ggx-keyhole-size';
  const SIZES = [
    { id: 's', label: 'Klein', px: 65 },
    { id: 'm', label: 'Mittel', px: 105 },
    { id: 'l', label: 'Groß', px: 160 },
  ];

  const state = {
    size: G.ui.load(SIZE_KEY, 'm'),
    mouse: null,
    frame: 0,
  };

  function radius() {
    return (SIZES.find((size) => size.id === state.size) ?? SIZES[1]).px;
  }

  function update() {
    state.frame = 0;
    const element = G.getPanoElement();
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const r = radius();
    const x = state.mouse ? state.mouse.x - rect.left : rect.width / 2;
    const y = state.mouse ? state.mouse.y - rect.top : rect.height / 2;
    G.setPanoEffect('keyhole', {
      mask: `radial-gradient(circle ${r}px at ${x}px ${y}px, #000 ${Math.round(r * 0.82)}px, transparent ${r}px)`,
      underlay: '#05040f',
    });
  }

  function onMove(event) {
    state.mouse = { x: event.clientX, y: event.clientY };
    if (!state.frame) state.frame = window.requestAnimationFrame(update);
  }

  G.registerMode({
    id: 'keyhole',
    icon: '🔦',
    name: 'Schlüsselloch',
    description: 'Du siehst nur einen kleinen Lichtkegel um deinen Mauszeiger. Leuchte die Umgebung ab!',

    start() {
      window.addEventListener('pointermove', onMove, true);
      update();
    },

    stop() {
      window.removeEventListener('pointermove', onMove, true);
      if (state.frame) window.cancelAnimationFrame(state.frame);
      state.frame = 0;
      G.setPanoEffect('keyhole', null);
    },

    round: update,
    tick: update,

    render(body) {
      G.ui.text(body, 'Lichtkegel-Größe:', { className: 'ggx-muted' });
      G.ui.choice(body, SIZES, state.size, (id) => {
        state.size = id;
        G.ui.save(SIZE_KEY, id);
        update();
        G.render();
      });
    },
  });
})();
