import test from 'node:test';
import assert from 'node:assert/strict';
import {signalRenderProfile, renderPixelRatio, createFrameGate} from '../render-performance.js';

const device = (userAgent, platform, maxTouchPoints, coarse = false) => ({
  navigator: {userAgent, platform, maxTouchPoints},
  matchMedia: () => ({matches: coarse}),
});

test('desktop-advertising iPad retains its touch budget with a trackpad attached', () => {
  for (const coarse of [true, false]) {
    const profile = signalRenderProfile(device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit Safari', 'MacIntel', 5, coarse));
    assert.ok(profile.ipad && profile.mobile);
    assert.equal(profile.maxFps, 60);
    assert.equal(profile.ring.samples, 2);
  }
});

test('phone, traditional iPad and coarse touch devices use bounded rendering without a width heuristic', () => {
  for (const env of [device('iPad Safari', 'iPad', 5), device('iPhone Safari', 'iPhone', 5), device('Android Chrome', 'Linux', 5), device('Browser', '', 5, true)]) {
    assert.ok(signalRenderProfile(env).mobile);
    env.innerWidth = 1920;
    assert.ok(signalRenderProfile(env).mobile);
  }
});

test('ordinary Macs, fine-pointer desktops and SSR preserve desktop rendering', () => {
  for (const env of [device('Macintosh Safari', 'MacIntel', 0), device('Windows Chrome', 'Win32', 10, false), {}]) {
    const p = signalRenderProfile(env);
    assert.equal(p.mobile, false);
    assert.equal(p.maxFps, Infinity);
    assert.equal(renderPixelRatio(900, 800, 2, p.ring), 1.7);
  }
});

test('Retina tablet buffers have bounded work in both orientations, with CSS aspect ratio unchanged', () => {
  const p = signalRenderProfile(device('Macintosh Safari', 'MacIntel', 5));
  for (const [w, h] of [[1366, 920], [1024, 1260], [2048, 1440], [844, 320]]) {
    for (const limits of [p.ring, p.galaxy, p.particles]) {
      const ratio = renderPixelRatio(w, h, 2, limits);
      assert.ok(Math.floor(w * ratio) * Math.floor(h * ratio) <= limits.maxPixels);
      assert.ok(ratio <= limits.maxDpr && ratio > 0);
      assert.ok(Math.abs((w * ratio) / (h * ratio) - w / h) < 1e-12);
      const degraded = renderPixelRatio(w, h, 2, limits, .8);
      assert.ok(degraded < ratio, 'fallback must reduce even an already area-limited buffer');
    }
  }
  for (const args of [[0, 0, 0], [NaN, Infinity, NaN]]) assert.ok(Number.isFinite(renderPixelRatio(...args, p.ring)));
});

test('ProMotion callbacks do not multiply visual work, while elapsed time remains available', () => {
  for (const hz of [60, 90, 120, 144]) {
    const gate = createFrameGate(60), frames = [];
    for (let i = 0; i < hz * 10; i++) {
      const now = i * 1000 / hz + (i % 3 - 1) * .025;
      if (gate.due(now)) frames.push(now);
    }
    assert.ok(Math.abs(frames.length - 600) <= 1, `${hz}Hz: ${frames.length}`);
    assert.ok(frames.at(-1) - frames[0] > 9950);
  }
  const desktop = createFrameGate(Infinity);
  assert.equal(Array.from({length: 120}, (_, i) => desktop.due(i * 1000 / 120)).filter(Boolean).length, 120);
});

test('resume and clock reset render promptly without a catch-up burst', () => {
  const gate = createFrameGate(60);
  assert.ok(gate.due(0)); assert.equal(gate.due(8), false);
  assert.ok(gate.due(5000)); assert.equal(gate.due(5008), false);
  gate.reset(); assert.ok(gate.due(5010)); assert.equal(gate.due(5011), false);
  assert.ok(gate.due(0)); assert.equal(gate.due(NaN), false);
});
