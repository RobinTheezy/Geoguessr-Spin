// Modus "Heiß & Kalt": Jeder Kartenklick misst die "Temperatur" zum Ziel. Begrenzte Messungen pro Runde.
(() => {
  'use strict';

  const G = window.__ggx;

  const MAX_READINGS = 5;
  // [unter km, Bezeichnung, Farbe]
  const LEVELS = [
    [25, 'Glühend heiß', '#ff1f1f'],
    [150, 'Sehr heiß', '#ff4d1f'],
    [500, 'Heiß', '#ff8a1f'],
    [1200, 'Warm', '#ffc21f'],
    [2500, 'Lauwarm', '#d9e35a'],
    [5000, 'Kühl', '#6fd3ff'],
    [9000, 'Kalt', '#3d8bff'],
    [Infinity, 'Eiskalt', '#a99bff'],
  ];

  const state = { readings: [], markers: [] };

  function clearMarkers() {
    state.markers.forEach((marker) => marker.setMap(null));
    state.markers = [];
  }

  function drawMarkers() {
    clearMarkers();
    const maps = window.google?.maps;
    if (!maps || !G.map) return;
    state.readings.forEach((reading, index) => {
      state.markers.push(new maps.Marker({
        map: G.map,
        position: reading.point,
        clickable: false,
        zIndex: 9000 + index,
        label: { text: String(index + 1), color: '#17132f', fontSize: '11px', fontWeight: '700' },
        icon: { path: maps.SymbolPath.CIRCLE, scale: 10, fillColor: reading.color, fillOpacity: 0.95, strokeColor: '#fff', strokeWeight: 2 },
      }));
    });
  }

  function reset() {
    state.readings = [];
    clearMarkers();
  }

  function trendOf(km, previous) {
    if (!previous) return '';
    const diff = previous.km - km;
    if (Math.abs(diff) < Math.max(5, previous.km * 0.03)) return '↔ gleich warm';
    return diff > 0 ? '🔥 wärmer' : '🧊 kälter';
  }

  G.registerMode({
    id: 'hotcold',
    icon: '🌡️',
    name: 'Heiß & Kalt',
    description: `Jeder Klick auf die Karte misst die Temperatur: heiß, kalt, wärmer, kälter. ${MAX_READINGS} Messungen pro Runde.`,

    stop: reset,
    round: reset,

    mapReady() {
      drawMarkers();
    },

    click(point) {
      if (!G.target || state.readings.length >= MAX_READINGS) return;
      const km = G.distanceKm(point, G.target);
      const [, label, color] = LEVELS.find(([max]) => km < max);
      state.readings.push({ point, km, label, color, trend: trendOf(km, state.readings.at(-1)) });
      drawMarkers();
    },

    render(body) {
      const ui = G.ui;
      if (!G.target) {
        ui.text(body, 'Warte auf Rundendaten...');
        return;
      }
      const latest = state.readings.at(-1);
      if (!latest) {
        ui.text(body, 'Klick auf die Karte, um die Temperatur zu messen.');
      } else {
        ui.text(body, latest.label, { className: 'ggx-big', color: latest.color });
        if (latest.trend) ui.text(body, latest.trend, { className: 'ggx-center' });
        state.readings.slice(0, -1).reverse().forEach((reading, index) => {
          const number = state.readings.length - 1 - index;
          ui.text(body, `${number}. ${reading.label}`, { className: 'ggx-muted', color: reading.color });
        });
      }
      const left = MAX_READINGS - state.readings.length;
      ui.text(body, left > 0 ? `Noch ${left} von ${MAX_READINGS} Messungen` : 'Thermometer leer – jetzt tippen!', { className: 'ggx-muted' });
      ui.bar(body, left / MAX_READINGS, latest?.color ?? '#ffd21f');
    },
  });
})();
