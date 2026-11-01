const STORAGE = 'duo.panels.v1';
const clamp = (value, min, max) => Math.min(Math.max(min, max), Math.max(min, value));

// Nonmodal editors share the root stacking context and retain their own placement.
export function createFloatingPanels(configurations,{storageKey=STORAGE}={}) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
  const panels = new Map(), stack = [], openingOrder = [];
  let drag = null, frame = 0;
  const safeArea = document.createElement('div');
  safeArea.className = 'panel-safe-area';
  safeArea.setAttribute('aria-hidden', 'true');
  document.body.append(safeArea);

  function persist() {
    const entries = {};
    for (const [id, panel] of panels) entries[id] = {open:!panel.element.hidden, position:panel.position};
    try { localStorage.setItem(storageKey, JSON.stringify({panels:entries, order:openingOrder, stack})); } catch {}
  }

  function bounds() {
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const safe = getComputedStyle(safeArea), inset = side => parseFloat(safe.getPropertyValue('padding-' + side)) || 0;
    const x = left + Math.max(12, inset('left')), y = top + Math.max(8, inset('top'));
    const right = left + width - Math.max(12, inset('right'));
    let bottom = top + height - Math.max(8, inset('bottom'));
    const footer = document.querySelector('.bottom-bar')?.getBoundingClientRect();
    if (footer && footer.top > y && footer.top < bottom && footer.bottom > top) bottom = footer.top - 8;
    return {x, y, width:Math.max(100, right - x), height:Math.max(100, bottom - y)};
  }

  function style(element, property, value) {
    if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
  }

  function move(panel, x, y, area = bounds()) {
    panel.x = clamp(x, area.x, area.x + area.width - panel.element.offsetWidth);
    panel.y = clamp(y, area.y, area.y + area.height - panel.element.offsetHeight);
    style(panel.element, '--panel-x', `${Math.round(panel.x * 100) / 100}px`);
    style(panel.element, '--panel-y', `${Math.round(panel.y * 100) / 100}px`);
  }

  function remember(panel, area = bounds()) {
    const travelX = Math.max(0, area.width - panel.element.offsetWidth);
    const travelY = Math.max(0, area.height - panel.element.offsetHeight);
    panel.position = {
      x:travelX > 0 ? clamp((panel.x - area.x) / travelX, 0, 1) : panel.position?.x ?? 1,
      y:travelY > 0 ? clamp((panel.y - area.y) / travelY, 0, 1) : panel.position?.y ?? 1,
    };
  }

  function activate(panel) {
    const index = stack.indexOf(panel.id);
    if (index !== -1) stack.splice(index, 1);
    stack.push(panel.id);
    stack.forEach((id, i) => style(panels.get(id).element, 'z-index', String(30 + i)));
    persist();
  }

  function layout() {
    frame = 0;
    if (drag) return;
    const area = bounds();
    const visible = openingOrder.map(id => panels.get(id)).filter(panel => !panel.element.hidden);
    // Leave travel above and below tall editors, including a short landscape viewport.
    const maxHeight = Math.min(560, Math.max(150, area.height - Math.max(44, area.height * .14)));
    for (const panel of visible) {
      style(panel.element, '--panel-width', `${Math.min(panel.width, area.width)}px`);
      style(panel.element, '--panel-max-height', `${Math.min(area.height, maxHeight)}px`);
    }
    const totalWidth = visible.reduce((sum, panel) => sum + panel.element.offsetWidth, 0) + (visible.length - 1) * 12;
    const sideBySide = totalWidth <= area.width;
    let x = area.x + area.width;
    const placed = [];
    for (let i = 0; i < visible.length; i++) {
      const panel = visible[i], w = panel.element.offsetWidth, h = panel.element.offsetHeight;
      let nextX, nextY;
      if (panel.position) {
        nextX = area.x + panel.position.x * Math.max(0, area.width - w);
        nextY = area.y + panel.position.y * Math.max(0, area.height - h);
      } else if (sideBySide) {
        nextX = x - w;
        nextY = area.y + area.height - h;
        // A manually moved editor owns its space; place a newly opened one beside it.
        const previous = placed.find(p => p.position);
        if (previous) {
          if (previous.x - 12 - w >= area.x) nextX = previous.x - 12 - w;
          else if (previous.x + previous.element.offsetWidth + 12 + w <= area.x + area.width) nextX = previous.x + previous.element.offsetWidth + 12;
        }
      } else {
        nextX = area.x + area.width - w;
        nextY = area.y + Math.max(0, area.height - maxHeight - 44) + i * 44;
      }
      move(panel, nextX, nextY, area);
      x = panel.x - 12;
      placed.push(panel);
    }
  }

  function scheduleLayout() {
    if (!frame) frame = requestAnimationFrame(layout);
  }

  function finishDrag(event) {
    if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    const current = drag;
    drag = null;
    current.panel.element.classList.remove('is-dragging');
    if (current.header.hasPointerCapture(current.pointerId)) current.header.releasePointerCapture(current.pointerId);
    if (current.moved) remember(current.panel);
    persist();
    scheduleLayout();
  }

  function open(id, focus = true) {
    const panel = panels.get(id);
    if (!panel || !panel.element.hidden) return;
    panel.beforeOpen?.();
    panel.element.hidden = false;
    panel.trigger.setAttribute('aria-expanded', 'true');
    if (!openingOrder.includes(id)) openingOrder.push(id);
    layout();
    activate(panel);
    if (focus) (panel.element.querySelector(panel.focus) || panel.handle).focus({preventScroll:true});
    persist();
  }

  function close(id, restoreFocus = false) {
    const panel = panels.get(id);
    if (!panel || panel.element.hidden) return false;
    if (drag?.panel === panel) finishDrag();
    panel.element.hidden = true;
    panel.trigger.setAttribute('aria-expanded', 'false');
    const index = stack.indexOf(id);
    if (index !== -1) stack.splice(index, 1);
    if (restoreFocus) panel.trigger.focus({preventScroll:true});
    persist();
    scheduleLayout();
    return true;
  }

  for (const config of configurations) {
    const element = document.getElementById(config.id), trigger = document.getElementById(config.trigger);
    const header = element.querySelector(config.header);
    const rawPosition = saved.panels?.[config.id]?.position;
    const position = Number.isFinite(rawPosition?.x) && Number.isFinite(rawPosition?.y)
      ? {x:clamp(rawPosition.x, 0, 1), y:clamp(rawPosition.y, 0, 1)} : null;
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'panel-drag-handle';
    handle.setAttribute('aria-label', `Move ${config.name} panel`);
    handle.setAttribute('aria-description', 'Drag to reposition. Arrow keys move 10 pixels; Shift and arrow keys move 40 pixels. Home resets position.');
    handle.title = 'Drag to move · Arrow keys to move · Shift for larger steps · Home to reset';
    handle.innerHTML = '<svg viewBox="0 0 12 20" aria-hidden="true"><circle cx="3" cy="5" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="3" cy="10" r="1"/><circle cx="9" cy="10" r="1"/><circle cx="3" cy="15" r="1"/><circle cx="9" cy="15" r="1"/></svg>';
    header.prepend(handle);
    header.classList.add('panel-drag-header');
    element.classList.add('floating-panel');
    document.body.append(element);
    const panel = {...config, element, trigger, header, handle, position, x:0, y:0};
    panels.set(config.id, panel);

    element.addEventListener('pointerdown', () => activate(panel));
    element.addEventListener('focusin', () => activate(panel));
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      const control = event.target.closest('button,input,select,textarea,a,[contenteditable]');
      if (control && control !== handle) return;
      event.preventDefault();
      handle.focus({preventScroll:true});
      const rect = element.getBoundingClientRect();
      drag = {panel, header, pointerId:event.pointerId, clientX:event.clientX, clientY:event.clientY, x:rect.left, y:rect.top, area:bounds(), moved:false};
      header.setPointerCapture(event.pointerId);
      element.classList.add('is-dragging');
    });
    header.addEventListener('pointermove', event => {
      if (!drag || drag.panel !== panel || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.clientX, dy = event.clientY - drag.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) move(panel, drag.x + dx, drag.y + dy, drag.area);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) header.addEventListener(type, finishDrag);
    function reset() {
      panel.position = null;
      layout();
      persist();
    }
    header.addEventListener('dblclick', event => {
      if (event.target.closest('button,input,select,textarea,a')?.matches('.panel-drag-handle') === false) return;
      reset();
    });
    handle.addEventListener('keydown', event => {
      const arrows = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]};
      if (event.key !== 'Home' && !arrows[event.key]) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Home') reset();
      else {
        const [dx,dy] = arrows[event.key], step = event.shiftKey ? 40 : 10;
        move(panel, panel.x + dx * step, panel.y + dy * step);
        remember(panel);
        persist();
      }
    });
  }

  for (const id of Array.isArray(saved.order) ? saved.order : []) if (panels.has(id) && !openingOrder.includes(id)) openingOrder.push(id);
  for (const id of panels.keys()) if (!openingOrder.includes(id)) openingOrder.push(id);
  for (const id of Array.isArray(saved.stack) ? saved.stack : []) if (panels.has(id) && saved.panels?.[id]?.open === true && !stack.includes(id)) stack.push(id);
  for (const panel of panels.values()) {
    if (saved.panels?.[panel.id]?.open === true) {
      panel.beforeOpen?.();
      panel.element.hidden = false;
      panel.trigger.setAttribute('aria-expanded', 'true');
      if (!stack.includes(panel.id)) stack.push(panel.id);
    }
  }
  stack.forEach((id, i) => style(panels.get(id).element, 'z-index', String(30 + i)));
  layout();
  const observer = new ResizeObserver(scheduleLayout);
  for (const panel of panels.values()) observer.observe(panel.element);
  const viewportChanged = () => { finishDrag(); scheduleLayout(); };
  window.addEventListener('resize', viewportChanged);
  window.visualViewport?.addEventListener('resize', viewportChanged);
  window.visualViewport?.addEventListener('scroll', viewportChanged);
  window.addEventListener('blur', () => finishDrag());
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishDrag(); });

  return {
    get dragging() { return !!drag; },
    open, close,
    toggle(id) {
      const panel = panels.get(id);
      if (!panel) return;
      if (panel.element.hidden) open(id);
      else if (stack.at(-1) !== id) { activate(panel); panel.handle.focus({preventScroll:true}); }
      else close(id, true);
    },
    closeActive(restoreFocus = false) {
      const focused = [...panels.values()].find(panel => !panel.element.hidden && panel.element.contains(document.activeElement));
      const id = focused?.id || stack.at(-1);
      return id ? close(id, restoreFocus) : false;
    },
  };
}
