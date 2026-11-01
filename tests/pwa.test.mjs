import test from 'node:test';
import assert from 'node:assert/strict';
import {setupPWA} from '../pwa.js';

function fixture(t, {prefix = false, enabled = true, manifestFullscreen = false} = {}) {
  const original = new Map(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const display = Object.assign(new EventTarget(), {matches: manifestFullscreen});
  const document = Object.assign(new EventTarget(), {documentElement: {}});
  const events = [], calls = [], toasts = [];
  const window = Object.assign(new EventTarget(), {
    isSecureContext: false,
    setInterval: () => 1,
    clearInterval: () => {},
    matchMedia: query => query === '(display-mode: fullscreen)' ? display : {matches: false}
  });
  const elementKey = prefix ? 'webkitFullscreenElement' : 'fullscreenElement';
  const changeEvent = prefix ? 'webkitfullscreenchange' : 'fullscreenchange';
  const enterKey = prefix ? 'webkitRequestFullscreen' : 'requestFullscreen';
  const exitKey = prefix ? 'webkitExitFullscreen' : 'exitFullscreen';
  document[prefix ? 'webkitFullscreenEnabled' : 'fullscreenEnabled'] = enabled;
  document.documentElement[enterKey] = options => {
    calls.push({action: 'enter', options});
    document[elementKey] = document.documentElement;
    document.dispatchEvent(new Event(changeEvent));
    return prefix ? undefined : Promise.resolve();
  };
  document[exitKey] = () => {
    calls.push({action: 'exit'});
    document[elementKey] = null;
    document.dispatchEvent(new Event(changeEvent));
    return prefix ? undefined : Promise.resolve();
  };
  window.addEventListener('duo:pwa', event => events.push(event.detail));
  for (const [key, value] of Object.entries({window, document, navigator: {}})) {
    Object.defineProperty(globalThis, key, {value, configurable: true});
  }
  const pwa = setupPWA({onToast: value => toasts.push(value)});
  t.after(() => {
    pwa.destroy();
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {pwa, window, document, display, calls, events, toasts, enterKey, elementKey, changeEvent};
}

test('fullscreen entry stays within the click gesture and requests hidden browser chrome', async t => {
  const f = fixture(t);
  assert.equal(f.pwa.canFullscreen, true);
  assert.equal(f.pwa.fullscreen, false);
  const request = f.pwa.toggleFullscreen();
  assert.deepEqual(f.calls, [{action: 'enter', options: {navigationUI: 'hide'}}]);
  assert.equal(await request, true);
  assert.equal(f.pwa.fullscreen, true);
  assert.equal(f.events.at(-1).fullscreen, true);
  assert.equal(f.events.at(-1).canFullscreen, true);
  assert.equal(await f.pwa.toggleFullscreen(), true);
  assert.equal(f.pwa.fullscreen, false);
  assert.deepEqual(f.calls.at(-1), {action: 'exit'});
});

test('browser-driven exit updates the display action without another button press', async t => {
  const f = fixture(t);
  await f.pwa.toggleFullscreen();
  f.document.fullscreenElement = null;
  f.document.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(f.events.at(-1).fullscreen, false);
  assert.equal(f.events.at(-1).canFullscreen, true);
});

test('unsupported or permission-policy-disabled fullscreen is not offered', async t => {
  const f = fixture(t, {enabled: false});
  assert.equal(f.pwa.canFullscreen, false);
  assert.equal(await f.pwa.toggleFullscreen(), false);
  f.document.fullscreenEnabled = true;
  delete f.document.documentElement.requestFullscreen;
  assert.equal(f.pwa.canFullscreen, false);
  assert.equal(await f.pwa.toggleFullscreen(), false);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.toasts, []);
});

test('prefixed WebKit fullscreen uses its matching entry, exit and change event', async t => {
  const f = fixture(t, {prefix: true});
  assert.equal(f.pwa.canFullscreen, true);
  assert.equal(await f.pwa.toggleFullscreen(), true);
  assert.equal(f.pwa.fullscreen, true);
  assert.deepEqual(f.calls, [{action: 'enter', options: undefined}]);
  assert.equal(f.events.at(-1).fullscreen, true);
  assert.equal(await f.pwa.toggleFullscreen(), true);
  assert.equal(f.pwa.fullscreen, false);
});

test('installed fullscreen display has no redundant API entry or invalid exit action', async t => {
  const f = fixture(t, {manifestFullscreen: true});
  assert.equal(f.pwa.installed, true);
  assert.equal(f.pwa.fullscreen, true);
  assert.equal(f.pwa.canFullscreen, false);
  assert.equal(await f.pwa.toggleFullscreen(), false);
  assert.deepEqual(f.calls, []);
  f.display.matches = false;
  f.display.dispatchEvent(new Event('change'));
  assert.equal(f.events.at(-1).fullscreen, false);
  assert.equal(f.events.at(-1).canFullscreen, true);
});

test('a rejected request is handled and can be retried', async t => {
  const f = fixture(t);
  const enter = f.document.documentElement.requestFullscreen;
  f.document.documentElement.requestFullscreen = () => Promise.reject(new TypeError('Denied'));
  assert.equal(await f.pwa.toggleFullscreen(), false);
  assert.equal(f.pwa.fullscreen, false);
  assert.equal(f.toasts.length, 1);
  f.document.documentElement.requestFullscreen = enter;
  assert.equal(await f.pwa.toggleFullscreen(), true);
});

test('pending requests are not repeated and teardown removes fullscreen listeners', async t => {
  const f = fixture(t);
  let finish, requests = 0;
  f.document.documentElement.requestFullscreen = () => {
    requests++;
    return new Promise(resolve => { finish = resolve; });
  };
  const pending = f.pwa.toggleFullscreen();
  assert.equal(await f.pwa.toggleFullscreen(), false);
  assert.equal(requests, 1);
  f.pwa.destroy();
  finish();
  await pending;
  f.document.dispatchEvent(new Event('fullscreenchange'));
  f.document.dispatchEvent(new Event('webkitfullscreenchange'));
  f.display.dispatchEvent(new Event('change'));
  assert.deepEqual(f.events, []);
  assert.equal(await f.pwa.toggleFullscreen(), false);
});
