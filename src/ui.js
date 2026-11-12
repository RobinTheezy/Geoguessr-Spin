// Schwebendes Widget: Kopfzeile mit Modus-Menue, darunter das Panel des aktiven Modus.
(() => {
  'use strict';

  const G = window.__ggx;

  const CSS = `
.ggx-root{position:fixed;left:16px;top:96px;z-index:2147483646;width:250px;max-width:calc(100vw - 32px);color:#fff;font:13px/1.4 system-ui,sans-serif;background:rgba(20,16,50,.93);border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.45);padding:10px 12px;box-sizing:border-box}
.ggx-root.ggx-compact{top:auto;bottom:16px;width:auto;padding:7px 11px}
.ggx-root *{box-sizing:border-box}
.ggx-head{display:flex;align-items:center;gap:8px;width:100%;padding:0;border:0;background:none;color:inherit;font:inherit;font-weight:700;cursor:pointer;text-align:left}
.ggx-head small{font-weight:400;color:#b9b4dd}
.ggx-caret{margin-left:auto;padding-left:6px;opacity:.7}
.ggx-menu{margin-top:8px;display:flex;flex-direction:column;gap:4px;max-height:65vh;overflow:auto;min-width:250px}
.ggx-option{display:flex;gap:8px;align-items:flex-start;width:100%;padding:6px 8px;border:1px solid transparent;border-radius:8px;background:rgba(255,255,255,.06);color:inherit;font:inherit;text-align:left;cursor:pointer}
.ggx-option:hover{background:rgba(255,255,255,.13)}
.ggx-option.ggx-on{border-color:#ffd21f;background:rgba(255,210,31,.13)}
.ggx-option-icon{font-size:17px;line-height:1.2}
.ggx-option small{display:block;color:#b9b4dd;font-size:11.5px;font-weight:400}
.ggx-body:not(:empty){margin-top:8px;border-top:1px solid rgba(255,255,255,.12);padding-top:6px}
.ggx-btn{display:block;width:100%;margin-top:8px;padding:6px;border:0;border-radius:6px;background:#ffd21f;color:#17132f;font:inherit;font-weight:600;cursor:pointer}
.ggx-btn:disabled{background:#59557a;color:#d6d3ea;cursor:default}
.ggx-btn.ggx-ghost{background:transparent;border:1px solid #ff3b3b;color:#ff8a8a}
.ggx-seg-row{display:flex;gap:4px;margin-top:8px}
.ggx-seg{flex:1;padding:4px 2px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:transparent;color:#d6d3ea;font:inherit;font-size:12px;cursor:pointer}
.ggx-seg.ggx-on{border-color:#ffd21f;background:rgba(255,210,31,.18);color:#fff;font-weight:600}
.ggx-seg-row.ggx-grid{display:grid;grid-template-columns:repeat(3,1fr)}
.ggx-section{margin-top:10px;border-top:1px solid rgba(255,255,255,.12);padding-top:8px}
.ggx-section-title{font-weight:700}
.ggx-toast{position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:2147483647;padding:12px 18px;border-radius:12px;background:rgba(60,8,30,.96);border:2px solid #ff3b7a;color:#fff;font:700 16px/1.3 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.6);pointer-events:none;text-align:center;max-width:90vw}
.ggx-muted{color:#b9b4dd;font-size:12px;margin-top:4px}
.ggx-big{font-size:19px;font-weight:800;text-align:center;margin:6px 0 2px}
.ggx-center{text-align:center}
.ggx-bar{height:7px;border-radius:4px;background:rgba(255,255,255,.15);overflow:hidden;margin-top:6px}
.ggx-bar>div{height:100%;border-radius:4px}
`;

  let style = null;
  let root = null;
  let headIcon = null;
  let headName = null;
  let menu = null;
  let body = null;
  let menuOpen = false;
  // Zusatzbereiche unter dem Modus-Panel (z. B. Flueche), unabhaengig vom gewaehlten Modus.
  const sections = [];

  function build() {
    style = document.createElement('style');
    style.textContent = CSS;

    root = document.createElement('div');
    root.className = 'ggx-root';

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'ggx-head';
    head.title = 'Spaßmodus wählen';
    headIcon = document.createElement('span');
    headName = document.createElement('span');
    const caret = document.createElement('span');
    caret.className = 'ggx-caret';
    caret.textContent = '▾';
    head.append(headIcon, headName, caret);
    head.addEventListener('click', () => {
      head.blur();
      menuOpen = !menuOpen;
      render();
    });

    menu = document.createElement('div');
    menu.className = 'ggx-menu';
    body = document.createElement('div');
    body.className = 'ggx-body';
    root.append(head, menu, body);

    // Klick ausserhalb schliesst das Menue.
    document.addEventListener('pointerdown', (event) => {
      if (menuOpen && !root.contains(event.target)) {
        menuOpen = false;
        render();
      }
    }, true);
  }

  function ensure() {
    if (root?.isConnected) return;
    if (!root) build();
    document.documentElement.append(style, root);
  }

  function option(mode) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `ggx-option${G.mode === mode ? ' ggx-on' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'ggx-option-icon';
    icon.textContent = mode ? mode.icon : '⏸️';
    const text = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = mode ? mode.name : 'Aus';
    const description = document.createElement('small');
    description.textContent = mode ? mode.description : 'Ganz normales GeoGuessr.';
    text.append(name, description);
    item.append(icon, text);
    item.addEventListener('click', () => {
      menuOpen = false;
      G.selectMode(mode?.id ?? 'off');
      render();
    });
    return item;
  }

  function renderMenu() {
    menu.hidden = !menuOpen;
    menu.replaceChildren();
    if (!menuOpen) return;
    for (const mode of G.modes) menu.append(option(mode));
    menu.append(option(null));
  }

  function render() {
    ensure();
    const inGame = G.inGame();
    root.classList.toggle('ggx-compact', !inGame && !menuOpen);
    headIcon.textContent = G.mode?.icon ?? '🌍';
    headName.replaceChildren();
    if (!inGame) {
      const label = document.createElement('small');
      label.textContent = 'Spaßmodus: ';
      headName.append(label);
    }
    headName.append(G.mode ? G.mode.name : 'aus');
    renderMenu();
    body.replaceChildren();
    if (!inGame || menuOpen) return;
    if (typeof G.mode?.render === 'function') {
      try {
        G.mode.render(body);
      } catch (error) {
        G.log('Fehler beim Zeichnen des Panels', error);
      }
    }
    for (const section of sections) {
      const container = document.createElement('div');
      try {
        section.render(container);
      } catch (error) {
        G.log('Fehler beim Zeichnen eines Bereichs', error);
      }
      if (container.childNodes.length === 0) continue;
      if (body.childNodes.length > 0) container.className = 'ggx-section';
      body.append(container);
    }
  }

  // section = { render(container), order? } – kleinere order steht weiter oben (Standard 0).
  function addSection(section) {
    sections.push(section);
    sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  let toastElement = null;
  let toastTimer = 0;
  function toast(message, ms = 3500) {
    toastElement?.remove();
    window.clearTimeout(toastTimer);
    toastElement = document.createElement('div');
    toastElement.className = 'ggx-toast';
    toastElement.textContent = message;
    document.documentElement.append(toastElement);
    toastTimer = window.setTimeout(() => {
      toastElement?.remove();
      toastElement = null;
    }, ms);
  }

  // ---------- Bausteine fuer Modus-Panels ----------

  function button(parent, label, onClick, { disabled = false, ghost = false } = {}) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `ggx-btn${ghost ? ' ggx-ghost' : ''}`;
    element.textContent = label;
    element.disabled = disabled;
    // Fokus abgeben, damit die Leertaste (GeoGuessr: Guess) den Knopf nicht erneut ausloest.
    element.addEventListener('click', (event) => {
      element.blur();
      onClick(event);
    });
    parent.append(element);
    return element;
  }

  function text(parent, content, { className = '', color = '' } = {}) {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = content;
    if (color) element.style.color = color;
    parent.append(element);
    return element;
  }

  function choice(parent, options, current, onPick, { grid = false } = {}) {
    const row = document.createElement('div');
    row.className = `ggx-seg-row${grid ? ' ggx-grid' : ''}`;
    for (const { id, label } of options) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `ggx-seg${id === current ? ' ggx-on' : ''}`;
      element.textContent = label;
      element.addEventListener('click', () => {
        element.blur();
        onPick(id);
      });
      row.append(element);
    }
    parent.append(row);
    return row;
  }

  function bar(parent, fraction, color = '#ffd21f') {
    const track = document.createElement('div');
    track.className = 'ggx-bar';
    const fill = document.createElement('div');
    fill.style.width = `${Math.round(G.clamp(fraction, 0, 1) * 100)}%`;
    fill.style.background = color;
    track.append(fill);
    parent.append(track);
    return track;
  }

  // Kleine Helfer fuer Einstellungen, die ein Modus sich merken will.
  function load(key, fallback) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Gilt dann nur bis zum Neuladen.
    }
  }

  G.ui = { render, ensure, button, text, choice, bar, load, save, addSection, toast };
})();
