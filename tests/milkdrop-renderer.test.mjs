import test from 'node:test';
import assert from 'node:assert/strict';
import { MilkdropRenderer, MILKDROP_FAMILIES, normalizeMilkdropParams, milkdropResolution, packMilkdropAudio } from '../instruments/milkdrop-renderer.js';

test('Milkdrop parameter boundary rejects nonfinite values and bounds every shader input', () => {
  const params = normalizeMilkdropParams({ family: 999, familyFrom: -4, familyMix: Infinity, palette: 999, paletteFrom: -2, paletteMix: -4, feedback: 1, warp: Infinity, motion: NaN, scale: 0, symmetry: 1000, lineWidth: -1, detail: Infinity, exposure: 900, colourSeparation: -100, response: 100, hue: 4, zoom: -99, rotation: 99, mirror: 9, raster: -4 });
  assert.equal(params.family, MILKDROP_FAMILIES.length - 1);
  assert.equal(params.familyFrom, 0);
  assert.equal(params.familyMix, 1);
  assert.equal(params.palette, 4);
  assert.equal(params.paletteFrom, 0);
  assert.equal(params.paletteMix, 0);
  assert.equal(params.feedback, .98);
  assert.equal(params.scale, .4);
  assert.equal(params.exposure, 1.8);
  assert.equal(params.response, 2);
  assert.equal(params.zoom, -1);
  assert.equal(params.rotation, 1);
  for (const [key, value] of Object.entries(params)) assert.ok(Number.isFinite(value), key);
});

test('Milkdrop framebuffer budget remains bounded on high-DPR phones and large desktop displays', () => {
  for (const [w, h, dpr] of [[1179, 2556, 3], [2048, 1536, 2], [3840, 2160, 3], [1280, 720, 1], [0, 0, 0], [Infinity, NaN, Infinity]]) {
    const size = milkdropResolution(w, h, dpr);
    assert.ok(size.width >= 1 && size.height >= 1);
    assert.ok(size.width * size.height <= 650000);
    assert.ok(Math.max(size.width, size.height) <= 1280);
    assert.ok(Number.isInteger(size.width) && Number.isInteger(size.height));
  }
});

test('Silent audio texture remains silent and does not synthesize fake spectrum data', () => {
  const bytes = packMilkdropAudio(new Float32Array(512), new Float32Array(256));
  for (let i = 0; i < 256; i++) {
    assert.equal(bytes[i * 4], 128);
    assert.equal(bytes[i * 4 + 1], 0);
    assert.equal(bytes[i * 4 + 3], 255);
  }
});

test('Audio packing preserves real waveform sign, FFT energy and reusable upload storage', () => {
  const storage = new Uint8Array(1024);
  const wave = Float32Array.from({ length: 512 }, (_, i) => i < 256 ? -1 : 1);
  const spectrum = Float32Array.from({ length: 256 }, (_, i) => i / 255);
  const result = packMilkdropAudio(wave, spectrum, storage);
  assert.equal(result, storage);
  assert.equal(result[0], 0);
  assert.equal(result[255 * 4], 255);
  assert.equal(result[1], 0);
  assert.equal(result[255 * 4 + 1], 255);
  assert.ok(result[128 * 4 + 1] > 0 && result[128 * 4 + 1] < 128);
});

test('Malformed audio data cannot generate invalid texture bytes', () => {
  const result = packMilkdropAudio([Infinity, -Infinity, NaN, 99, -99], [NaN, Infinity, -1, 9]);
  for (let i = 0; i < result.length; i++) assert.ok(result[i] >= 0 && result[i] <= 255);
  assert.equal(result[1], 0);
});

function rendererState() {
  return Object.assign(Object.create(MilkdropRenderer.prototype), {
    params: {}, audioBytes: new Uint8Array(1024), envelopes: new Float32Array(4),
    phases: new Float32Array(4), touches: new Float32Array(16), clock: 0,
    canvas: { width: 800, height: 500 }, _drawFallback() {}
  });
}

test('Audio envelope response has the same timescale at 30 fps and 60 fps', () => {
  const lowRate = rendererState(), highRate = rendererState();
  const frequency = new Float32Array(256).fill(.7);
  for (let i = 0; i < 30; i++) lowRate._audio(null, frequency, .3, 1 / 30);
  for (let i = 0; i < 60; i++) highRate._audio(null, frequency, .3, 1 / 60);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(lowRate.envelopes[i] - highRate.envelopes[i]) < 1e-6);
  for (let i = 0; i < 120; i++) highRate._audio(null, null, 0, 1 / 60);
  assert.ok(highRate.envelopes[3] < .00002, 'measured output decays back to silence');
});

test('Motion zero and reduced motion stop the autonomous clock while touch input remains live', () => {
  const renderer = rendererState();
  renderer.frame({ dt: .02, params: { motion: 0 }, pointers: [{ x: .9, y: .2, pressure: .8 }] });
  assert.equal(renderer.clock, 0);
  assert.ok(renderer.touches[0] > 1 && renderer.touches[1] > .5);
  renderer.frame({ dt: .02, params: { motion: 2 }, reducedMotion: true, pointers: [{ x: .2, y: .8, pressure: .5 }] });
  assert.equal(renderer.clock, 0);
  assert.ok(renderer.touches[0] < -.8 && renderer.touches[1] < -.5);
  renderer.frame({ dt: .02, params: { motion: 2 } });
  assert.equal(renderer.clock, .04);
});
