// Signal's rendering budget follows device capabilities, not viewport width.
// iPadOS can advertise a desktop Mac user agent even in an installed PWA.
export function signalRenderProfile(env = globalThis) {
  const nav = env.navigator || {};
  const agent = String(nav.userAgent || '');
  const platform = String(nav.platform || '');
  const touches = Number(nav.maxTouchPoints) || 0;
  const ipad = /iPad/i.test(agent) ||
    (touches > 1 && (/Mac/i.test(platform) || /Macintosh/i.test(agent)));
  let coarse = false;
  try { coarse = !!env.matchMedia?.('(pointer: coarse)').matches; } catch {}
  const mobile = ipad || /iPhone|iPod|Android/i.test(agent) ||
    nav.userAgentData?.mobile === true || (coarse && touches > 0);
  return {
    mobile, ipad, maxFps: mobile ? 60 : Infinity,
    ring: {maxDpr: mobile ? 1.5 : 1.7, maxPixels: mobile ? 700000 : Infinity, samples: mobile ? 2 : 4},
    galaxy: {maxDpr: 1.5, maxPixels: mobile ? 500000 : Infinity},
    particles: {maxDpr: 1.5, maxPixels: mobile ? 1000000 : Infinity},
  };
}

const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

// CSS coordinates stay unchanged. Only the backing resolution is adjusted.
export function renderPixelRatio(width, height, dpr, limits, quality = 1) {
  const w = positive(width, 1), h = positive(height, 1);
  const budget = positive(limits?.maxPixels, Infinity);
  const ratio = Math.min(positive(dpr, 1), positive(limits?.maxDpr, 1.5), Math.sqrt(budget / w / h));
  return ratio * Math.min(1, Math.max(.25, positive(quality, 1)));
}

// Accumulate deadlines rather than waiting a fixed interval after every frame:
// this preserves a 60Hz average on 120/144Hz displays and tolerates RAF jitter.
// The renderer retains its own elapsed-time clock across skipped callbacks.
export function createFrameGate(maxFps = Infinity) {
  const interval = Number.isFinite(maxFps) && maxFps > 0 ? 1000 / maxFps : 0;
  let deadline = null, last = null;
  return {
    due(now) {
      if (!Number.isFinite(now)) return false;
      if (!interval) return true;
      if (deadline === null || now < last || now - deadline > 250) {
        last = now; deadline = now + interval; return true;
      }
      last = now;
      if (now + .1 < deadline) return false;
      deadline += Math.max(1, Math.floor((now + .1 - deadline) / interval) + 1) * interval;
      return true;
    },
    reset() { deadline = null; last = null; },
  };
}
