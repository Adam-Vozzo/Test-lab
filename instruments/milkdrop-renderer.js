// Original feedback visualizer. No projectM code or preset assets are used here.
// WebGL 1, two RGBA8 history buffers, bounded resolution and no GPU readback.
export const MILKDROP_FAMILIES = Object.freeze(['flow', 'kaleido', 'tunnel', 'interference', 'plasma', 'orbit', 'lattice', 'spectral']);
export const MILKDROP_DEFAULTS = Object.freeze({ family: 0, hue: .52, palette: 0, feedback: .84, warp: .45, motion: .45, scale: 1, symmetry: 5, lineWidth: 1, detail: .6, exposure: 1, colourSeparation: .25, response: .8, zoom: .2, rotation: .15, mirror: 0, raster: .12 });

const TAU = Math.PI * 2;
const finite = (n, d = 0) => Number.isFinite(Number(n)) ? Number(n) : d;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const bounds = { family: [0, 7], palette: [0, 4], hue: [0, 1], feedback: [0, .98], warp: [0, 1.5], motion: [0, 2], scale: [.4, 2], symmetry: [2, 12], lineWidth: [.3, 2.5], detail: [0, 1], exposure: [.4, 1.8], colourSeparation: [0, 1], response: [0, 2], zoom: [-1, 1], rotation: [-1, 1], mirror: [0, 1], raster: [0, 1] };

export function normalizeMilkdropParams(input = {}, target = {}) {
  for (const key in bounds) target[key] = clamp(finite(input[key], MILKDROP_DEFAULTS[key]), ...bounds[key]);
  target.family = Math.round(target.family);
  target.palette = Math.round(target.palette);
  target.familyFrom = Math.round(clamp(finite(input.familyFrom, target.family), 0, 7));
  target.familyMix = clamp(finite(input.familyMix, 1), 0, 1);
  target.paletteFrom = Math.round(clamp(finite(input.paletteFrom, target.palette), 0, 4));
  target.paletteMix = clamp(finite(input.paletteMix, 1), 0, 1);
  return target;
}

export function milkdropResolution(width, height, dpr = 1) {
  const w = Math.max(1, finite(width, 1));
  const h = Math.max(1, finite(height, 1));
  const ratio = Math.min(clamp(finite(dpr, 1), .5, 1.5), 1280 / Math.max(w, h), Math.sqrt(650000 / (w * h)));
  return { width: Math.max(1, Math.floor(w * ratio)), height: Math.max(1, Math.floor(h * ratio)) };
}

// The texture contains measured audio only. Silence stays a flat waveform and zero FFT.
export function packMilkdropAudio(waveform, frequency, output = new Uint8Array(1024)) {
  for (let i = 0; i < 256; i++) {
    const w = waveform?.length ? finite(waveform[Math.min(waveform.length - 1, Math.floor(i * waveform.length / 256))]) : 0;
    const f = frequency?.length ? finite(frequency[Math.min(frequency.length - 1, Math.round(Math.pow(i / 255, 2.2) * (frequency.length - 1)))]) : 0;
    output[i * 4] = Math.round((clamp(w, -1, 1) * .5 + .5) * 255);
    output[i * 4 + 1] = Math.round(clamp(f, 0, 1) * 255);
    output[i * 4 + 2] = 0;
    output[i * 4 + 3] = 255;
  }
  return output;
}

const vertex = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() { v_uv = a_position * .5 + .5; gl_Position = vec4(a_position, 0., 1.); }
`;

const feedbackFragment = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_history;
uniform sampler2D u_audioTex;
uniform vec4 u_view; // aspect, inverse width, inverse height, delta seconds
uniform vec4 u_time;
uniform vec4 u_audio; // bass, mid, treble, measured RMS
uniform vec4 u_shape; // scale, symmetry, line width, detail
uniform vec4 u_flow; // frame-adjusted retention, warp, motion, response
uniform vec4 u_palette; // hue, palette, exposure, colour separation
uniform vec4 u_modes; // family, source family, morph, mirror
uniform vec4 u_effects; // zoom, rotation, raster, reduced motion
uniform vec2 u_paletteBlend;
uniform vec4 u_touch[4];
const float PI = 3.14159265;
const float TAU = 6.2831853;
mat2 turn(float a) { float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float wave(float x) { return (texture2D(u_audioTex, vec2(clamp(x,.002,.998),.5)).r - .50196) * 2. * u_flow.w; }
float spectrum(float x) { return texture2D(u_audioTex, vec2(clamp(x,.002,.998),.5)).g * u_flow.w; }
float line(float d, float w) { float q=w/(abs(d)+w); return q*q*q; }
vec3 paletteAt(float x, float mode) {
  float h=x+u_palette.x;
  vec3 c=.52+.48*cos(TAU*(h+vec3(0.,.34,.67)));
  if(mode>.5 && mode<1.5) c=mix(vec3(.09,.22,.62),vec3(.45,.92,1.),.5+.5*sin(h*TAU));
  else if(mode<2.5 && mode>1.5) c=mix(vec3(.72,.035,.24),vec3(1.,.65,.12),.5+.5*cos(h*TAU));
  else if(mode<3.5 && mode>2.5) c=mix(vec3(.32,.08,.8),vec3(.72,1.,.16),.5+.5*sin(h*TAU));
  else if(mode>3.5) c=mix(vec3(.33,.46,.58),vec3(.94,.92,.85),.5+.5*sin(h*TAU));
  return c;
}
vec3 palette(float x) { return mix(paletteAt(x,u_paletteBlend.x),paletteAt(x,u_palette.y),u_paletteBlend.y); }
vec2 transport(vec2 p, float family) {
  float dt=u_view.w*u_flow.z*(1.-u_effects.w);
  float power=u_flow.y*(.65+u_audio.x*u_flow.w*.3);
  vec2 q=turn(dt*(u_effects.y*.44))*p*(1.-dt*u_effects.x*.42);
  if(family<.5) {
    vec2 centre=vec2(-.28+.18*sin(u_time.y),.12*cos(u_time.z));
    vec2 d=q-centre;
    q=centre+turn(dt*power*.42/(.2+dot(d,d)))*d;
    q+=dt*power*.52*vec2(sin(p.y*3.4+u_time.x)+.35*sin(p.x*6.-p.y*2.-u_time.z),cos(p.x*2.5-u_time.y));
    q+=dt*power*u_shape.w*.13*vec2(sin(p.y*13.+p.x*5.+u_time.z),cos(p.x*11.-p.y*4.-u_time.x));
  } else if(family<1.5) {
    float a=atan(p.y,p.x), r=length(p);
    q=turn(dt*(.15+sin(a*u_shape.y+u_time.y)*power*.24))*q;
    q*=1.+dt*.12*cos(a*u_shape.y+u_time.x)*power;
  } else if(family<2.5) {
    q*=1.-dt*(.23+power*.12);
    q=turn(dt*(.12+power*.18/(.3+length(p))))*q;
  } else if(family<3.5) {
    q+=dt*power*.21*vec2(sin(p.y*5.+u_time.y),sin(p.x*4.-u_time.x));
    q.x+=dt*.1*p.y;
  } else if(family<4.5) {
    vec2 centre=vec2(sin(u_time.y),cos(u_time.z))*.24;
    vec2 d=p-centre;
    q=centre+turn(dt*power*.4/(.5+dot(d,d)))*d;
    q+=dt*power*.1*vec2(cos(p.y*7.+u_time.x),sin(p.x*6.-u_time.z));
  } else if(family<5.5) {
    q=turn(dt*(.3+power*.3))*q;
    q*=1.+dt*.06*sin(atan(p.y,p.x)*3.+u_time.z);
  } else if(family<6.5) {
    q+=dt*power*.18*vec2(sin(p.y*4.+u_time.x),cos(p.x*4.-u_time.y));
    q.y*=1.-dt*.08;
  } else {
    q*=1.-dt*(.18+u_audio.x*u_flow.w*.14);
    q=turn(dt*.12*sin(length(p)*5.+u_time.y))*q;
  }
  for(int i=0;i<4;i++) {
    vec2 d=p-u_touch[i].xy;
    float force=u_touch[i].z*u_view.w*.18/(.16+dot(d,d));
    q+=vec2(-d.y,d.x)*force*(.7+u_touch[i].w);
    q-=d*force*.28;
  }
  vec2 mirrored=vec2(abs(q.x),q.y);
  return mix(q,mirrored,u_modes.w*clamp(dt*3.,0.,.2));
}
vec3 geometry(vec2 p,float family) {
  p/=u_shape.x;
  float w=(.0012+u_view.z*1.4)*u_shape.z/u_shape.x;
  float detail=u_shape.w;
  float energy=clamp(u_audio.w*3.,0.,1.5)*u_flow.w;
  float bass=u_audio.x*u_flow.w;
  float r=length(p), a=atan(p.y,p.x);
  vec3 col=vec3(0.);
  if(family<.5) {
    // A bent material coordinate keeps fine contours coherent as the history
    // is stretched through the larger eddies, instead of overlaying noise.
    vec2 q=p;
    q+=u_flow.y*.28*vec2(sin(p.y*2.8+sin(p.x*1.4+u_time.x)),sin(p.x*2.1+u_time.y));
    q+=u_flow.y*detail*.09*vec2(sin(q.y*8.-u_time.z),sin(q.x*7.+u_time.x));
    float material=q.y+sin(q.x*1.7+u_time.x)*.3+cos(q.x*3.7-q.y*2.+u_time.z)*.15;
    material+=wave(p.x/(u_view.x*2.)+.5)*(.07+energy*.16);
    for(int i=0;i<4;i++) {
      float fi=float(i);
      float yy=material-(fi-1.5)*.21;
      yy+=sin(q.x*(4.+fi*.7)-u_time.y+fi*1.7)*(.025+energy*.02);
      col+=palette(q.x*.14+fi*.11+sin(u_time.z)*.08)*line(yy,w*(.8+energy*.3))*.8;
    }
    float corridor=1.-smoothstep(.43,.9,abs(material));
    float frequency=7.+detail*13.;
    float ridges=abs(fract(material*frequency)-.5)/frequency;
    col+=palette(material*.5+q.x*.15+.25)*line(ridges,w*.43)*corridor*detail*.58;
    float folded=material+.035*detail*(sin(q.x*13.+q.y*9.-u_time.y)+sin(q.y*19.+q.x*4.+u_time.x));
    float filaments=abs(fract(folded*(18.+detail*18.))-.5)/(18.+detail*18.);
    col+=palette(folded*.7+q.x*.1+.55)*line(filaments,w*.24)*corridor*detail*.27;
    // Very low-density colour between edges makes the material read as a
    // folded surface while leaving the highlights narrow and unsaturated.
    col+=palette(material*.35+.4)*corridor*.008*detail;
  } else if(family<1.5) {
    float petals=cos(a*u_shape.y+u_time.x);
    float corr=wave(fract(a/TAU+.5))*(.03+energy*.08);
    for(int i=0;i<3;i++) {
      float fi=float(i), edge=.25+fi*.19+petals*(.07+u_flow.y*.09)+corr;
      edge+=sin(a*(u_shape.y*2.)-u_time.y)*.025*detail;
      col+=palette(a/TAU+fi*.19)*line(r-edge,w*(1.+fi*.3));
    }
    float chamber=r-petals*(.07+u_flow.y*.09)+sin(a*u_shape.y*2.+r*9.-u_time.y)*detail*.042;
    float frequency=7.+detail*13.;
    float contours=abs(fract(chamber*frequency)-.5)/frequency;
    float chamberMask=smoothstep(.16,.24,r)*(1.-smoothstep(.7,.92,r));
    col+=palette(chamber*.6+a/TAU)*line(contours,w*.43)*chamberMask*detail*.56;
    float ribs=abs(sin(a*u_shape.y+r*6.+u_time.z))*max(r,.03)/u_shape.y;
    col+=palette(.65+chamber)*line(ribs,w*.26)*chamberMask*detail*.16;
    col*=smoothstep(.07,.18,r);
  } else if(family<2.5) {
    float lr=log(max(r,.025));
    float depth=lr*(2.4+detail*2.)-u_time.x/TAU;
    float rings=abs(fract(depth)-.5)*max(r,.06)/(2.4+detail*2.);
    float spokes=abs(sin(a*(3.+u_shape.y)+lr*u_effects.y*.8+u_time.z)) * max(r,.03)/(3.+u_shape.y);
    col=palette(lr*.25+u_time.y/TAU)*line(rings,w)*.85;
    col+=palette(a/TAU+.3)*line(spokes,w*.5)*(.25+.65*spectrum(fract(a/TAU+.5)));
    col*=smoothstep(.025,.1,r)*(1.-smoothstep(1.1,1.8,r));
  } else if(family<3.5) {
    float f=4.+detail*7.;
    float field=sin(p.x*f+u_time.x)*cos(p.y*f*.82-u_time.y);
    field+=sin(length(p-vec2(.3*sin(u_time.z),.25))*f*1.4-u_time.z)*.55;
    field+=wave(p.x/(2.*u_view.x)+.5)*energy*.5;
    float d=abs(fract(field*(1.2+u_flow.y))-.5)/f;
    col=palette(field*.2+p.x*.1)*line(d,w*.7)*(.65+.35*cos(p.y*2.));
    col*=1.-smoothstep(.8,1.7,r);
  } else if(family<4.5) {
    vec2 q=p+u_flow.y*.18*vec2(sin(p.y*3.+u_time.y),cos(p.x*3.-u_time.x));
    q+=detail*u_flow.y*.045*vec2(sin(q.y*11.+u_time.z),cos(q.x*9.-u_time.y));
    float field=0.;
    for(int i=0;i<4;i++) {
      float fi=float(i);
      vec2 c=vec2(sin(u_time.x+fi*1.8),cos(u_time.y+fi*2.3))*(.26+fi*.1);
      vec2 d=q-c;
      field+=(.12+bass*.025)/(.12+dot(d,d));
    }
    field+=sin(field*7.+q.x*12.-q.y*5.+u_time.z)*detail*.045;
    float contours=abs(fract(field*(1.5+detail*1.4))-.5);
    col=palette(field*.13+p.y*.08)*line(contours,w*(5.+field));
    float fineContours=abs(fract(field*(5.+detail*3.))-.5);
    col+=palette(field*.16+.35)*line(fineContours,w*(2.+field*.6))*detail*.28;
    col+=palette(field*.16+.3)*pow(clamp(field*.1,0.,.4),2.)*.12;
    col*=1.-smoothstep(1.1,1.9,r);
  } else if(family<5.5) {
    for(int i=0;i<4;i++) {
      float fi=float(i);
      vec2 q=turn(fi*.72+u_time.x)*p;
      q.x+=sin(u_time.y+fi)*.1;
      float ratio=.4+fi*.14;
      float oval=length(vec2(q.x,q.y/ratio));
      float perturb=sin(atan(q.y,q.x)*(3.+fi)+u_time.z)*u_flow.y*.04;
      col+=palette(fi*.19+a/TAU*.12)*line(oval-(.54+fi*.075)-perturb-wave(fract(a/TAU+.5))*energy*.08,w/ratio);
    }
  } else if(family<6.5) {
    vec2 q=turn(.4+u_time.z)*p;
    q+=vec2(sin(q.y*3.+u_time.x),sin(q.x*3.-u_time.y))*.1*u_flow.y;
    float spacing=3.+detail*5.;
    vec2 g=abs(fract(q*spacing)-.5)/spacing;
    float diagonal=abs(fract((q.x+q.y)*spacing)-.5)/spacing;
    float lines=line(min(g.x,g.y),w*.65)+line(diagonal,w*.4)*.35;
    col=palette(q.x*.22+q.y*.17+sin(u_time.y)*.06)*lines;
    col*=.3+.7*(1.-smoothstep(.2,1.5,r));
    col*=1.-smoothstep(.9,1.8,r);
  } else {
    float angular=fract(a/TAU+.5);
    float bins=32.+floor(detail*64.);
    float bin=(floor(angular*bins)+.5)/bins;
    float strength=spectrum(bin);
    float radius=.36+wave(angular)*(.03+energy*.1);
    float angleDist=abs(fract(angular*bins)-.5)*max(r,.04)*TAU/bins;
    float bar=line(angleDist,w*.8)*smoothstep(.35,.37,r)*(1.-smoothstep(.38+strength*.65,.4+strength*.65,r));
    col=palette(angular+sin(u_time.z)*.06)*(bar*.8+line(r-radius,w)*.85);
    col+=palette(.4+angular)*line(r-(.75+bass*.1),w*.45)*.2;
    col+=palette(.7-angular)*line(r-(.57+sin(a*u_shape.y+u_time.x)*.035),w*.35)*.25;
  }
  for(int i=0;i<4;i++) {
    vec2 local=u_touch[i].xy/u_shape.x;
    float dist=length(p-local);
    col+=palette(float(i)*.17+dist*.5)*line(dist-(.035+u_touch[i].w*.025),w*1.4)*u_touch[i].z*.45;
  }
  return col*(.65+energy*.65);
}
void main() {
  vec2 p=(v_uv-.5)*2.; p.x*=u_view.x;
  vec2 q=transport(p,u_modes.x);
  vec3 injection=geometry(p,u_modes.x);
  if(u_modes.z<.999 && abs(u_modes.x-u_modes.y)>.1) {
    q=mix(transport(p,u_modes.y),q,u_modes.z);
    injection=mix(geometry(p,u_modes.y),injection,u_modes.z);
  }
  vec2 uv=q/vec2(u_view.x,1.)*.5+.5;
  vec2 shift=vec2(u_view.y,u_view.z)*u_palette.w*1.3*u_flow.z*(1.-u_effects.w);
  vec3 history=texture2D(u_history,uv).rgb;
  history.r=texture2D(u_history,uv+shift).r;
  history.b=texture2D(u_history,uv-shift).b;
  float boundsFade=smoothstep(0.,.012,uv.x)*smoothstep(0.,.012,uv.y)*(1.-smoothstep(.988,1.,uv.x))*(1.-smoothstep(.988,1.,uv.y));
  history*=u_flow.x*boundsFade;
  float injectGain=clamp(u_view.w*60.,.25,3.)*.19;
  vec3 result=history+injection*injectGain*(1.-history*.83);
  // Unbiased sub-byte rounding is essential with RGBA8 history: otherwise
  // low values round back to themselves on every pass and never fade out.
  // This is below one colour step, not a visible grain/post-process effect.
  float rounding=(fract(dot(fract(gl_FragCoord.xy/vec2(16.,19.)),vec2(.754877,.56984))+u_time.w)-.5)/255.;
  result+=vec3(rounding);
  gl_FragColor=vec4(clamp(result,0.,1.),1.);
}
`;

const displayFragment = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_history;
uniform vec4 u_display; // exposure, raster, width, height
void main() {
  vec3 c=texture2D(u_history,v_uv).rgb;
  c=1.-exp(-c*u_display.x*1.8);
  c=pow(max(c,vec3(0.)),vec3(.92));
  float scan=.5+.5*cos(v_uv.y*u_display.w*3.14159265);
  c*=1.-u_display.y*.13*scan;
  gl_FragColor=vec4(c,1.);
}
`;

function compile(gl, source, type) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Milkdrop shader: ${error}`);
  }
  return shader;
}

function createProgram(gl, fragment) {
  let vs, fs, program;
  try {
    vs = compile(gl, vertex, gl.VERTEX_SHADER);
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    fs = compile(gl, precision?.precision ? fragment : fragment.replace('precision highp float;', 'precision mediump float;'), gl.FRAGMENT_SHADER);
    program = gl.createProgram();
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Milkdrop link: ${gl.getProgramInfoLog(program)}`);
    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
  }
}

function fallbackPalette(phase, hue, mode) {
  const h = (phase + hue) * TAU;
  let first, second, mix;
  if (mode === 1) { first = [.09, .22, .62]; second = [.45, .92, 1]; mix = .5 + .5 * Math.sin(h); }
  else if (mode === 2) { first = [.72, .035, .24]; second = [1, .65, .12]; mix = .5 + .5 * Math.cos(h); }
  else if (mode === 3) { first = [.32, .08, .8]; second = [.72, 1, .16]; mix = .5 + .5 * Math.sin(h); }
  else if (mode === 4) { first = [.33, .46, .58]; second = [.94, .92, .85]; mix = .5 + .5 * Math.sin(h); }
  else return [0, .34, .67].map(offset => .52 + .48 * Math.cos(h + offset * TAU));
  return first.map((value, i) => value + (second[i] - value) * mix);
}

export class MilkdropRenderer {
  constructor(host, { onUnavailable } = {}) {
    this.host = host;
    this.onUnavailable = onUnavailable;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'milkdrop-feedback-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    host.append(this.canvas);
    this.params = normalizeMilkdropParams();
    this.audioBytes = new Uint8Array(1024);
    this.envelopes = new Float32Array(4);
    this.touches = new Float32Array(16);
    this.phases = new Float32Array(4);
    this.clock = 0;
    this.frameIndex = 0;
    this.targets = [];
    this.programs = [];
    this.readIndex = 0;
    this.lost = false;
    this.destroyed = false;
    this._contextLost = event => { event.preventDefault(); this.lost = true; };
    this._contextRestored = () => {
      this.lost = false;
      try { this._initGL(); this.resize(this.width, this.height, this.dpr, true); } catch (error) { this._fallback(error); }
    };
    this.canvas.addEventListener('webglcontextlost', this._contextLost);
    this.canvas.addEventListener('webglcontextrestored', this._contextRestored);
    try { this._initGL(); } catch (error) { this._fallback(error); }
    const rect = host.getBoundingClientRect();
    this.resize(rect.width || 640, rect.height || 400, globalThis.devicePixelRatio || 1);
  }

  _initGL() {
    const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.backend = 'webgl';
    this.programs = [];
    this.targets = [];
    this.feedbackProgram = createProgram(gl, feedbackFragment);
    this.programs.push(this.feedbackProgram);
    this.displayProgram = createProgram(gl, displayFragment);
    this.programs.push(this.displayProgram);
    this.positions = new Map(this.programs.map(program => [program, gl.getAttribLocation(program, 'a_position')]));
    this.uniforms = {};
    for (const name of ['u_history', 'u_audioTex', 'u_view', 'u_time', 'u_audio', 'u_shape', 'u_flow', 'u_palette', 'u_modes', 'u_effects', 'u_paletteBlend', 'u_touch[0]']) this.uniforms[name] = gl.getUniformLocation(this.feedbackProgram, name);
    this.displayUniforms = { texture: gl.getUniformLocation(this.displayProgram, 'u_history'), display: gl.getUniformLocation(this.displayProgram, 'u_display') };
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    this.audioTexture = this._texture(256, 1, packMilkdropAudio(null, null, this.audioBytes));
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.DITHER);
  }

  _texture(width, height, data = null) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return texture;
  }

  _releaseGL() {
    const gl = this.gl;
    if (!gl || this.lost) return;
    for (const target of this.targets) { gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer); }
    for (const program of this.programs) gl.deleteProgram(program);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.audioTexture) gl.deleteTexture(this.audioTexture);
    this.targets = []; this.programs = [];
  }

  _fallback(error) {
    this._releaseGL();
    if (this.gl && !this.lost) this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
    this.backend = 'canvas2d';
    // A canvas cannot change context types after requesting WebGL.
    const replacement = document.createElement('canvas');
    replacement.className = this.canvas.className;
    replacement.style.cssText = this.canvas.style.cssText;
    replacement.setAttribute('aria-hidden', 'true');
    this.canvas.removeEventListener('webglcontextlost', this._contextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._contextRestored);
    this.canvas.replaceWith(replacement);
    this.canvas = replacement;
    this.ctx = replacement.getContext('2d', { alpha: false });
    this.onUnavailable?.(error);
  }

  resize(width, height, dpr = 1, force = false) {
    if (this.destroyed) return;
    this.width = Math.max(1, finite(width, 1)); this.height = Math.max(1, finite(height, 1)); this.dpr = finite(dpr, 1);
    const size = milkdropResolution(this.width, this.height, this.dpr);
    if (!force && this.canvas.width === size.width && this.canvas.height === size.height && (this.targets.length || !this.gl)) return;
    this.canvas.width = size.width; this.canvas.height = size.height;
    if (!this.gl || this.lost) return;
    const gl = this.gl;
    for (const target of this.targets) { gl.deleteTexture(target.texture); gl.deleteFramebuffer(target.framebuffer); }
    this.targets = [];
    try {
      for (let i = 0; i < 2; i++) {
        const texture = this._texture(size.width, size.height);
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        this.targets.push({ texture, framebuffer });
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Feedback framebuffer unavailable');
      }
      this.reset();
    } catch (error) {
      this._fallback(error);
      this.canvas.width = size.width; this.canvas.height = size.height;
    }
  }

  _audio(waveform, frequency, rms, dt) {
    let low = 0, mid = 0, high = 0;
    const length = frequency?.length || 0;
    for (let i = 0; i < length; i++) {
      const value = clamp(finite(frequency[i]), 0, 1);
      if (i < length * .08) low += value;
      else if (i < length * .35) mid += value;
      else high += value;
    }
    const measured = [low / Math.max(1, Math.ceil(length * .08)), mid / Math.max(1, Math.ceil(length * .35) - Math.ceil(length * .08)), high / Math.max(1, length - Math.ceil(length * .35)), clamp(finite(rms), 0, 1)];
    for (let i = 0; i < 4; i++) this.envelopes[i] += (measured[i] - this.envelopes[i]) * (1 - Math.exp(-dt * (measured[i] > this.envelopes[i] ? 16 : 5)));
    packMilkdropAudio(waveform, frequency, this.audioBytes);
  }

  frame({ dt = 1 / 60, waveform, frequency, rms = 0, params, pointers = [], reducedMotion = false } = {}) {
    if (this.destroyed || this.lost) return;
    const p = normalizeMilkdropParams(params, this.params);
    const delta = clamp(finite(dt, 1 / 60), 1 / 240, .05);
    this._audio(waveform, frequency, rms, delta);
    if (!reducedMotion) this.clock += delta * p.motion;
    this.phases[0] = (this.clock * .31) % TAU;
    this.phases[1] = (this.clock * .23) % TAU;
    this.phases[2] = (this.clock * .13) % TAU;
    this.frameIndex = ((this.frameIndex || 0) + 1) % 4096;
    this.phases[3] = (this.frameIndex * .61803398875) % 1;
    this.touches.fill(0);
    // A temporarily collapsed container must not send unbounded coordinates
    // into mediump fragment arithmetic during an orientation transition.
    const aspect = clamp(this.canvas.width / this.canvas.height, .125, 8);
    for (let i = 0; i < Math.min(4, pointers.length); i++) {
      const pointer = pointers[i];
      this.touches[i * 4] = (clamp(finite(pointer.x, .5), 0, 1) * 2 - 1) * aspect;
      this.touches[i * 4 + 1] = 1 - clamp(finite(pointer.y, .5), 0, 1) * 2;
      this.touches[i * 4 + 2] = clamp(finite(pointer.pressure, .5), 0, 1);
      this.touches[i * 4 + 3] = clamp(Math.hypot(finite(pointer.vx), finite(pointer.vy)), 0, 2);
    }
    if (!this.gl) { this._drawFallback(p, reducedMotion); return; }
    if (this.targets.length !== 2) return;
    const gl = this.gl, u = this.uniforms;
    const source = this.targets[this.readIndex], destination = this.targets[1 - this.readIndex];
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
    this._use(this.feedbackProgram);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, source.texture); gl.uniform1i(u.u_history, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.audioTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.audioBytes);
    gl.uniform1i(u.u_audioTex, 1);
    gl.uniform4f(u.u_view, aspect, 1 / this.canvas.width, 1 / this.canvas.height, delta);
    gl.uniform4fv(u.u_time, this.phases); gl.uniform4fv(u.u_audio, this.envelopes);
    gl.uniform4f(u.u_shape, p.scale, p.symmetry, p.lineWidth, p.detail);
    gl.uniform4f(u.u_flow, Math.pow(p.feedback, delta * 8), p.warp, p.motion, p.response);
    gl.uniform4f(u.u_palette, p.hue, p.palette, p.exposure, p.colourSeparation);
    gl.uniform4f(u.u_modes, p.family, p.familyFrom, p.familyMix, p.mirror);
    gl.uniform4f(u.u_effects, p.zoom, p.rotation, p.raster, reducedMotion ? 1 : 0);
    gl.uniform2f(u.u_paletteBlend, p.paletteFrom, p.paletteMix);
    gl.uniform4fv(u['u_touch[0]'], this.touches);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._use(this.displayProgram);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, destination.texture);
    gl.uniform1i(this.displayUniforms.texture, 0);
    gl.uniform4f(this.displayUniforms.display, p.exposure, p.raster, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.readIndex = 1 - this.readIndex;
  }

  _use(program) {
    const gl = this.gl;
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const position = this.positions.get(program);
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  _drawFallback(p, reducedMotion) {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = reducedMotion ? '#03050a' : `rgba(3,5,10,${.06 + (1 - p.feedback) * .35})`;
    ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2, h / 2);
    const t = this.clock, radius = h * .28 * p.scale * (1 + p.zoom * .1);
    ctx.rotate(t * p.rotation * .06);
    ctx.lineWidth = Math.max(.7, p.lineWidth * h / 600);
    for (let band = 0; band < 5; band++) {
      ctx.beginPath();
      const colour = fallbackPalette(band * .13, p.hue, p.palette);
      const from = fallbackPalette(band * .13, p.hue, p.paletteFrom);
      const channels = colour.map((value, i) => Math.round(clamp((from[i] + (value - from[i]) * p.paletteMix) * p.exposure, 0, 1) * 255));
      ctx.strokeStyle = `rgba(${channels.join(',')},${clamp(.48 + this.envelopes[3] * p.response, .3, .9)})`;
      for (let i = 0; i <= 192; i++) {
        const f = i / 192, a = f * TAU;
        const wave = (this.audioBytes[Math.min(255, Math.floor(f * 255)) * 4] - 128) / 128 * p.response;
        let x, y;
        if (p.family === 0 || p.family === 3 || p.family === 6) {
          x = (f - .5) * w;
          y = Math.sin(f * (6 + band) + t * .3) * radius * (.2 + p.warp * .2) + Math.sin(f * (10 + p.detail * 12) - t * .2) * radius * .1 + (band - 2) * h * .06 + wave * h * .1;
        } else {
          const fft = this.audioBytes[Math.min(255, Math.floor(f * 255)) * 4 + 1] / 255;
          const rr = radius * (.45 + band * .13) * (1 + Math.sin(a * p.symmetry + t * .3) * p.warp * .12) + wave * h * .06 + (p.family === 7 ? fft * p.response * h * .14 : 0);
          x = Math.cos(a + t * .08) * rr;
          y = Math.sin(a + t * .08) * rr * (p.family === 5 ? .45 + band * .1 : 1);
        }
        for (let touch = 0; touch < 4; touch++) {
          const tx = this.touches[touch * 4] * h / 2, ty = -this.touches[touch * 4 + 1] * h / 2;
          const dx = tx - x, dy = ty - y;
          const influence = this.touches[touch * 4 + 2] * .28 / (1 + (dx * dx + dy * dy) / (h * h * .04));
          x += dx * influence; y += dy * influence;
        }
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  reset() {
    this.readIndex = 0;
    this.frameIndex = 0;
    const gl = this.gl;
    if (gl && !this.lost) {
      gl.clearColor(0, 0, 0, 1);
      for (const target of this.targets) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clear(gl.COLOR_BUFFER_BIT);
    } else if (this.ctx) {
      this.ctx.fillStyle = '#03050a'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.removeEventListener('webglcontextlost', this._contextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._contextRestored);
    this._releaseGL();
    if (this.gl && !this.lost) this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
    this.ctx = null; this.gl = null;
  }
}
