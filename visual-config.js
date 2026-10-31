export const DEFAULT_VISUAL = Object.freeze({
  ringRadius: 1.7, ringThickness: .55, beadSize: .045, density: 1, twist: .2, spread: .1,
  depth: 1, scale: 1, tilt: .55, rotation: 0, perspective: 35,
  speed: .12, damping: .65, turbulence: .2, reactivity: .6, trail: .35, idle: .35,
  beadBreath: .14, beadBreathRate: 8,
  glow: .45, glowRadius: .4, glowThreshold: .55, blur: 0, grain: .06, vignette: .35,
  roughness: .32, metalness: .75, lightAngle: 45, ambient: .6,
  exposure: 1, contrast: 1.08, saturation: 1, hue: 0, temperature: 0,
  gridOpacity: .2, gridSpacing: 1, gridWeight: 1, gridType: 'cartesian', gridFade: .5,
  particleSize: 1, particleDensity: .5, connections: .3,
  labelScale: 1, centreGap: 12, scanlines: 0, fringe: 0,
  trailDotCount:80, trailDotSize:5.2, matrixPitch:5.5, matrixAsciiPitch:12, matrixGap:.28, matrixShape:'square',
  matrixExposure:.6, matrixContrast:1, matrixThreshold:.06, matrixValueSize:.35,
  particleBloom:.4, particleBloomRadius:5, particleBloomThreshold:.45,
  skyDensity:.8, skySpread:1, skyDepth:1.3, skyDrift:.15, skyTwinkle:.4, skyLinks:.35,
  strandCount:38, strandLength:.65, strandChaos:.7,
  trailMotionSpeed:.22, trailMotionAmount:.65, trailFlowSpeed:.28, matrixAudioResponse:.8,
  trailDragStrength:1, trailTension:.55, trailDragDamping:.6,
  sequenceTitle:'Sequence', envelopeTitle:'Envelope',
  copyVisibility:'full', textTracking:0,
  fieldDepth:.7, fieldSpread:1, signalWidth:1.5, seed: 42, freeze: false, phase: 0,
  bg: '#10100f', fg: '#e9e1d3', accent: '#e4a56c', secondary: '#7eaaa5',
});

const look = (name, palette, overrides = {}) => ({ name, palette, visual: { ...DEFAULT_VISUAL, ...palette, ...overrides } });
// Preserve customized sessions when the built-in Signal default changes.
const PREVIOUS_SIGNAL_VISUAL = look('Signal', {bg:'#050609',fg:'#f4f4ff',accent:'#ffe579',secondary:'#79d9ff',muted:'#b4b7ce'}, {ringRadius:1.65,ringThickness:.57,beadSize:.047,density:.85,twist:.035,spread:.07,depth:.9,tilt:.82,rotation:-.6,scale:.74,roughness:.78,metalness:.06,glow:.28,glowRadius:.22,glowThreshold:.66,grain:.015,vignette:.06,contrast:1.04,ambient:.6,gridOpacity:.5,gridWeight:1,gridFade:0,particleDensity:.8,particleSize:1,connections:1,fieldDepth:.7,fieldSpread:1,signalWidth:1.5,reactivity:1,trail:.6,speed:.03,idle:.15}).visual;

// Signal appearance supplied by the instrument owner. Other looks retain their own defaults.
const SIGNAL_VISUAL = Object.freeze({
  "ringRadius": 1.93,
  "ringThickness": 0.4,
  "beadSize": 0.08,
  "density": 1.5,
  "twist": -0.4,
  "spread": 0.6,
  "depth": 0.93,
  "scale": 1.25,
  "tilt": 0.14,
  "rotation": 0.62,
  "perspective": 48,
  "speed": 0.1,
  "damping": 0.52,
  "turbulence": 1,
  "reactivity": 1,
  "trail": 0.66,
  "idle": 1,
  "beadBreath": 0.14,
  "beadBreathRate": 8,
  "glow": 1,
  "glowRadius": 0.51,
  "glowThreshold": 0.5,
  "blur": 1,
  "grain": 0.35,
  "vignette": 0.8,
  "roughness": 0.51,
  "metalness": 0.66,
  "lightAngle": 229,
  "ambient": 1,
  "exposure": 1,
  "contrast": 1.2,
  "saturation": 1,
  "hue": -31,
  "temperature": 0,
  "gridOpacity": 0.5,
  "gridSpacing": 0.7,
  "gridWeight": 1,
  "gridType": "cartesian",
  "gridFade": 1,
  "particleSize": 0.62,
  "particleDensity": 1.2,
  "connections": 0.3,
  "labelScale": 1,
  "centreGap": 12,
  "scanlines": 0.15,
  "fringe": 0.25,
  "trailDotCount": 200,
  "trailDotSize": 8,
  "matrixPitch": 8,
  "matrixAsciiPitch": 12,
  "matrixGap": 0.25,
  "matrixShape": "circle",
  "matrixExposure": 0,
  "matrixContrast": 1,
  "matrixThreshold": 0.1,
  "matrixValueSize": 0.6,
  "particleBloom": 1.5,
  "particleBloomRadius": 20,
  "particleBloomThreshold": 0.5,
  "skyDensity": 1.2,
  "skySpread": 0.75,
  "skyDepth": 1.3,
  "skyDrift": 0.75,
  "skyTwinkle": 1,
  "skyLinks": 0.5,
  "strandCount": 72,
  "strandLength": 1,
  "strandChaos": 0.75,
  "trailMotionSpeed": 0.5,
  "trailMotionAmount": 1,
  "trailFlowSpeed": 0.5,
  "matrixAudioResponse": 0.75,
  "trailDragStrength": 1,
  "trailTension": 0.5,
  "trailDragDamping": 0.3,
  "sequenceTitle": "Sequence",
  "envelopeTitle": "Envelope",
  "copyVisibility": "full",
  "textTracking": 0.06,
  "fieldDepth": 1,
  "fieldSpread": 0.75,
  "signalWidth": 1,
  "seed": 42,
  "freeze": false,
  "phase": 0,
  "bg": "#000000",
  "fg": "#f4f4ff",
  "accent": "#e83b77",
  "secondary": "#ff0088"
});

export const LOOKS = Object.freeze({
  signal: look('Signal', {bg:'#000000',fg:'#f4f4ff',accent:'#e83b77',secondary:'#ff0088',muted:'#b4b7ce'}, SIGNAL_VISUAL),
  ember: look('Ember', {bg:'#10100f', fg:'#e9e1d3', accent:'#e4a56c', secondary:'#7eaaa5', muted:'#aaa397'}, { grain:.075, glow:.4, roughness:.26, metalness:.82, tilt:.95, rotation:-.12, scale:.94 }),
  phosphor: look('Phosphor', {bg:'#081218', fg:'#e3eff0', accent:'#8bdeeb', secondary:'#ecd194', muted:'#9cb1b9'}, { glow:.65, glowRadius:.5, contrast:1.12, grain:.025, metalness:.65 }),
  vellum: look('Vellum', {bg:'#e9e3d5', fg:'#3f413e', accent:'#b96845', secondary:'#738eab', muted:'#696b61'}, { glow:.12, grain:.095, vignette:.12, roughness:.2, metalness:.25, contrast:1, ambient:.85, particleDensity:.3 }),
  ultraviolet: look('Ultraviolet', {bg:'#110d1d', fg:'#e8def3', accent:'#bb91ed', secondary:'#d9e78e', muted:'#ad9cbd'}, { glow:.7, glowRadius:.55, grain:.025, contrast:1.18, saturation:1.15, metalness:.8, particleDensity:.65 }),
});

const range = (key,label,min,max,step,advanced=false,unit='') => ({key,label,min,max,step,advanced,unit,type:'range'});
const colour = (key,label) => ({key,label,type:'color'});
const copy = (key,label,maxLength=32,hint='') => ({key,label,maxLength,hint,type:'text'});
// Each parameter appears once, under the surface it changes. Shared scene
// settings are separate from the galaxy-only guides and ring-only finish.
export const VISUAL_SURFACES = Object.freeze([
  {id:'galaxy',name:'Galaxy',groups:['grid']},
  {id:'ring',name:'Ring',groups:['form','motion','light','finish']},
  {id:'particles',name:'Particles',groups:['trails','texture','bloom']},
  {id:'shared',name:'Shared',groups:['palette','guides','microcopy','layout']},
]);

export const VISUAL_GROUPS = [
  {id:'grid',name:'Stars & map guides',symbol:'✦',description:'Star volume, constellations and the galaxy’s local grid.', controls:[
    range('skyDensity','Star count',.2,1.5,.01), range('skySpread','Galaxy spread',.5,1.6,.01),
    range('skyDepth','Galaxy depth',.3,2.5,.05),
    range('skyDrift','Star drift',0,1,.01), range('skyTwinkle','Star twinkle',0,1,.01), range('skyLinks','Constellation links',0,1,.01),
    {key:'gridType',label:'Galaxy guide',type:'select',options:[['cartesian','Cartesian'],['polar','Orbital'],['dots','Dotted']]},
    range('gridWeight','Guide line width',.3,2,.05,true), range('gridFade','Guide edge fade',0,1,.01,true),
  ]},
  {id:'form',name:'Form',symbol:'◉',description:'Size, bead structure and camera framing of the right-hand ring.', controls:[
    range('scale','Ring size',.5,1.25,.01), range('ringRadius','Ring radius',1.1,2.3,.01),
    range('ringThickness','Ring tube width',.2,.9,.01), range('beadSize','Bead size',.02,.08,.001),
    range('density','Bead count',.35,1.5,.01), range('spread','Bead irregularity',0,.6,.01),
    range('twist','Ring twist',-.8,.8,.01), range('tilt','Ring tilt',-.6,1.3,.01),
    range('depth','Ring depth',.6,1.5,.01,true), range('rotation','Ring orientation',-3.14,3.14,.01,true),
    range('perspective','Ring perspective',25,60,1,true,'°'), range('particleSize','Ring particle size',.3,2,.01,true),
  ]},
  {id:'motion',name:'Motion',symbol:'∿',description:'Bead movement, rotation and sound response. Particle motion is in Particles → Paths & motion.', controls:[
    range('beadBreath','Bead breathing',0,.25,.01), range('beadBreathRate','Breathing rate',2,20,.5,false,' /min'),
    range('speed','Rotation speed',-.5,.5,.01), range('damping','Rotation smoothing',.1,.95,.01),
    range('turbulence','Bead ripple',0,1,.01), range('reactivity','Sound response',0,1.5,.01),
    range('idle','Idle wobble',0,1,.01),
  ]},
  {id:'palette',name:'Colors',symbol:'◐',description:'Colors shared by the interface, galaxy, ring and particles. Ring-only grading is in Ring → Finish.', controls:[
    colour('bg','Background'), colour('fg','Labels & highlights'), colour('accent','Notes & voice wedges'), colour('secondary','Galaxy, core & trails'),
  ]},
  {id:'light',name:'Light & material',symbol:'☼',description:'Lighting, surface material and glow of the right-hand ring.', controls:[
    range('glow','Ring glow',0,1.5,.01), range('glowRadius','Glow spread',0,1,.01),
    range('glowThreshold','Glow threshold',0,1,.01), range('ambient','Ring fill light',.1,1.5,.01),
    range('lightAngle','Ring light angle',0,360,1,false,'°'), range('roughness','Bead roughness',0,1,.01),
    range('metalness','Bead metallic',0,1,.01),
  ]},
  {id:'texture',name:'Dot matrix',symbol:'⠿',description:'Render the moving trails as dots or ASCII characters on a fixed screen grid. Unlit cells stay transparent.', controls:[
    {key:'matrixShape',label:'Cell style',type:'select',options:[['square','Square'],['circle','Circle'],['ascii','ASCII']]},
    {...range('matrixPitch','Grid spacing',2,18,.5,false,'px'),exceptWhen:{key:'matrixShape',value:'ascii'}},
    {...range('matrixAsciiPitch','Character spacing',8,24,1,false,'px'),onlyWhen:{key:'matrixShape',value:'ascii'}},
    {...range('matrixGap','Cell gap',0,.8,.01),labels:{ascii:'Character inset'},descriptions:{ascii:'Inset each character within its cell without changing the character grid.'}},
    {...range('matrixValueSize','Brightness sizing',0,1,.01),exceptWhen:{key:'matrixShape',value:'ascii'}},
    range('matrixExposure','Base exposure',-2,2,.05,false,' EV'), range('matrixAudioResponse','Loudness response',0,2,.05),
    range('matrixContrast','Matrix contrast',.4,2.5,.05),
    range('matrixThreshold','Cell cutoff',0,.75,.01),
    range('trailDotSize','Emission width',.6,12,.1,false,'px'), range('trailDotCount','Samples per path',12,240,1),
  ]},
  {id:'bloom',name:'Bloom',symbol:'☼',description:'Soft light from bright matrix cells. Applies to particles only.', controls:[
    range('particleBloom','Bloom intensity',0,2,.01), range('particleBloomRadius','Bloom radius',1,24,.5,false,'px'),
    range('particleBloomThreshold','Bloom cutoff',0,1,.01),
  ]},
  {id:'trails',name:'Paths & motion',symbol:'∿',description:'BPM-linked particle flow from the crosshair into the ring centre, with elastic drag and slow waves.', controls:[
    range('trailDragStrength','Drag influence',0,1.5,.01), range('trailTension','Wave tension',0,1,.01),
    range('trailDragDamping','Drag damping',.15,1,.01),
    range('trailMotionSpeed','Wave speed',0,1,.01), range('trailMotionAmount','Wave amplitude',0,1.5,.01),
    range('trailFlowSpeed','Particle flow rate',0,1.5,.01,false,' /beat'),
    range('strandCount','Path count',8,72,1), range('strandLength','Path curvature',.2,1.5,.01),
    range('strandChaos','Path disorder',0,1,.01), range('particleDensity','Path density',0,1.2,.01),
    range('fieldSpread','Path spread',.3,1.8,.01), range('fieldDepth','Path depth',0,1.5,.01,true),
    range('trail','Release persistence',0,1,.01,true), range('connections','Voice arc opacity',0,1,.01),
    range('signalWidth','Voice arc width',.5,3,.05,false,'px'),
  ]},
  {id:'finish',name:'Finish',symbol:'◌',description:'Color grading and post-processing on the ring image only.', controls:[
    range('hue','Ring hue',-180,180,1,false,'°'), range('saturation','Ring saturation',0,1.6,.01),
    range('contrast','Ring contrast',.7,1.6,.01), range('exposure','Ring exposure',.5,1.5,.01),
    range('temperature','Ring warmth',-1,1,.01), range('blur','Ring softness',0,4,.1),
    range('grain','Ring grain',0,.35,.005), range('vignette','Ring vignette',0,.8,.01),
    range('scanlines','Ring scanlines',0,.5,.01,true), range('fringe','Ring color fringe',0,1,.01,true),
  ]},
  {id:'guides',name:'Scene guides',symbol:'◎',description:'Guide settings shared by the galaxy grid and ring orbits.',controls:[
    range('gridOpacity','Guide opacity',0,.8,.01), range('gridSpacing','Guide spacing',.4,2.5,.05),
  ]},
  {id:'layout',name:'Layout',symbol:'↔',description:'Spacing between the galaxy and ring panels.',controls:[
    range('centreGap','Panel gap',0,40,1,false,'px'),
  ]},
  {id:'microcopy',name:'Labels & typography',symbol:'Aa',description:'Map annotations, section labels and monospace typography.', controls:[
    {key:'copyVisibility',label:'Map & section labels',type:'select',options:[['full','Shown'],['none','Hidden']]},
    range('labelScale','Map & section label size',.9,1.25,.01), range('textTracking','Label letter spacing',-.03,.12,.005,false,'em'),
    copy('sequenceTitle','Sequence label'), copy('envelopeTitle','Envelope label'),
  ]},
];

const CONTROL_GUIDANCE = {
 skyDensity:['Filter map','Add or remove stars in the 3D galaxy.'],
 skySpread:['Filter map','Expand the star cloud around its fixed centre.'],
 skyDepth:['Filter map','Stretch the stellar volume into near and far layers. Filter coordinates remain unchanged.'],
 skyDrift:['Filter map','Set the stars’ gentle background movement.'],
 skyTwinkle:['Galaxy stars','Amount of slow brightness variation, with an independent rhythm for each star. Zero keeps star brightness steady.'],
 skyLinks:['Filter map','Fade the lines joining constellation stars.'],
 gridType:['Galaxy','Choose the galaxy’s reference-grid shape. Ring orbits are unchanged.'],
 gridOpacity:['Galaxy & ring','Fade the galaxy grid and the ring’s orbital guides together.'],
 gridSpacing:['Galaxy & ring','Set galaxy grid spacing at each zoom level and scale the ring’s orbital guides.'],
 gridWeight:['Galaxy','Thicken the galaxy’s reference-grid lines.'],
 gridFade:['Filter map','Soften guides near the galaxy’s edge.'],
 centreGap:['Layout','Space between sky and ring in wide view.'],
 scale:['Ring','Scale the entire ring scene in its panel.'],
 ringRadius:['Ring','Widen the ring around its central opening.'],
 ringThickness:['Ring','Thicken the ring’s beaded tube.'],
 beadSize:['Ring','Resize each bead without adding beads.'],
 density:['Ring','Add or remove beads around the ring.'],
 spread:['Ring','Scatter beads away from their regular rows.'],
 twist:['Ring','Twist the bead rows around the ring.'],
 tilt:['Ring','Tip the ring toward or away from you.'],
 depth:['Ring','Stretch the ring along its depth axis.'],
 rotation:['Ring','Turn the ring within its current view.'],
 perspective:['Ring','Change the camera’s sense of depth.'],
 speed:['Ring motion','Set the ring’s automatic rotation speed.'],
 damping:['Ring','Ease changes in ring rotation.'],
 turbulence:['Ring','Increase the small waves in the bead rows.'],
 beadBreath:['Ring beads','Amount of independent bead growth and shrinkage. Each bead has its own phase and rhythm; zero keeps bead size steady.'],
 beadBreathRate:['Ring beads','Average breathing cycles per minute, with individual variation. Independent of tempo and sound.'],
 reactivity:['Sound response','Strength of ring and trail response to sound.'],
 idle:['Ring','Amount of gentle movement while idle.'],
 bg:['Interface','Set the instrument’s background color.'],
 fg:['Text & ring','Tint labels, readouts and ring highlights.'],
 accent:['Notes & ring','Tint lit ring sectors, notes and controls.'],
 secondary:['Scene tint','Tint galaxy stars, ring core and dotted trails.'],
 glow:['Ring','Make bright ring details glow.'],
 glowRadius:['Ring','Spread the ring’s glow farther outward.'],
 glowThreshold:['Ring','Choose how bright a detail must be to glow.'],
 ambient:['Ring','Brighten the ring’s shaded surfaces.'],
 lightAngle:['Ring','Move the main light around the ring.'],
 roughness:['Ring','Make bead highlights softer and broader.'],
 metalness:['Ring','Shift the beads toward a metallic surface.'],
 strandCount:['Trail paths','Set the base number of independent lines.'],
 strandLength:['Trail paths','Increase path curvature between the crosshair and ring centre.'],
 strandChaos:['Trail paths','Vary each line’s bend and direction.'],
 particleDensity:['Trails & particles','Scale trails; other looks also gain ring particles.'],
 trailDotSize:['Particle source','Widen each emission before matrix sampling; wider emissions light more grid cells.'],
 trailDotCount:['Particle source','Set emission samples along each path before matrix sampling. More samples produce fuller trails.'],
 matrixPitch:['Dot matrix','Set the distance between grid-cell centres. Larger spacing makes a coarser matrix.'],
 matrixAsciiPitch:['ASCII matrix','Set the distance between character centres. This grid is saved separately from dot spacing.'],
 matrixGap:['Dot matrix','Set empty space around each cell. Larger gaps make smaller, more separated dots.'],
 matrixShape:['Trail rendering','Draw sampled trail brightness as square pixels, circular dots or ASCII characters. Denser characters represent brighter cells.'],
 matrixValueSize:['Dot matrix','Shrink dim cells according to brightness. Zero keeps all lit cells the same size.'],
 matrixExposure:['Dot matrix','Set the exposure bias in stops, before the measured output loudness response.'],
 matrixAudioResponse:['Dot matrix','Scale exposure with measured audio output. Zero disables this response; base exposure remains adjustable.'],
 trailMotionSpeed:['Trail paths','Set the speed of the broad, continuous waves. Zero holds the current wave phase.'],
 trailMotionAmount:['Trail paths','Set how far the paths bend with the slow waves; both endpoints stay anchored.'],
 trailFlowSpeed:['Trail paths','Forward travel per beat. At 0.25, particles cross a path in four beats. Higher BPM increases speed; zero pauses flow.'],
 trailDragStrength:['Trail paths','Set how strongly crosshair movement pulls the paths. Zero disables drag deformation.'],
 trailTension:['Trail paths','Set the elastic tension. Higher values send the disturbance along the paths faster.'],
 trailDragDamping:['Trail paths','Control how quickly drag-induced movement settles. Higher values reduce recoil.'],
 matrixContrast:['Dot matrix','Separate dim and bright cells while keeping the grid fixed.'],
 matrixThreshold:['Dot matrix','Hide cells below this brightness level, from 0 to 1.'],
 particleBloom:['Particle bloom','Set the intensity of blurred light around bright matrix cells. Zero disables bloom.'],
 particleBloomRadius:['Particle bloom','Set how far particle light spreads beyond the crisp cells.'],
 particleBloomThreshold:['Particle bloom','Only cells above this brightness level contribute to bloom, from 0 to 1.'],
 fieldSpread:['Trail paths','Widen the fan of paths; the crosshair and ring endpoints stay fixed.'],
 fieldDepth:['Trail paths','Separate trails into near and far layers.'],
 particleSize:['Ring particles','Resize ambient ring particles in Ember, Phosphor, Vellum and Ultraviolet.'],
 trail:['Trails & ring traces','Extend trail release and ambient ring traces.'],
 connections:['Voice arcs','Fade the smooth live and sequencer curves.'],
 signalWidth:['Voice arcs','Thicken the smooth voice connections.'],
 hue:['Ring finish','Rotate the ring image’s color spectrum.'],
 saturation:['Ring finish','Increase or reduce ring color intensity.'],
 contrast:['Ring finish','Separate the ring’s dark and light tones.'],
 exposure:['Ring finish','Brighten the rendered ring image.'],
 temperature:['Ring finish','Shift the ring image cooler or warmer.'],
 blur:['Ring finish','Soften the ring image on screen.'],
 grain:['Ring finish','Add fine noise to the ring image.'],
 vignette:['Ring finish','Darken the ring image toward its edges.'],
 scanlines:['Ring finish','Overlay fine horizontal lines on the ring.'],
 fringe:['Ring finish','Separate colors slightly along ring edges.'],
 copyVisibility:['Map & sections','Show or hide map annotations and section labels. Parameter readouts remain visible.'],
 labelScale:['Map & sections','Resize map annotations and section labels.'],
 textTracking:['Map & sections','Adjust letter spacing in map annotations and section labels.'],
 sequenceTitle:['Sequencer','Label above the note grid.'],
 envelopeTitle:['Envelope','Label above the envelope graph.'],
};
for (const group of VISUAL_GROUPS) for (const control of group.controls) {
  const [target,description] = CONTROL_GUIDANCE[control.key];
  Object.assign(control,{target,description});
}

export const VISUAL_CONTROLS = VISUAL_GROUPS.flatMap(group => group.controls);

export function sanitiseVisual(input = {}, base = DEFAULT_VISUAL) {
  const result = {...DEFAULT_VISUAL,...base};
  for (const control of VISUAL_CONTROLS) {
    const value = input[control.key];
    if (control.type === 'range' && typeof value === 'number' && Number.isFinite(value)) result[control.key] = Math.max(control.min, Math.min(control.max, value));
    if (control.type === 'color' && typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) result[control.key] = value;
    if (control.type === 'select' && control.options.some(([key]) => key === value)) result[control.key] = value;
    if (control.type === 'text' && typeof value === 'string') result[control.key] = value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0,control.maxLength);
  }
  // Previous free-particle size was a visible square; the raster now samples its footprint.
  if (Number.isFinite(input.trailDotSize) && !Object.hasOwn(input,'matrixShape')) result.trailDotSize = Math.max(.6,Math.min(12,input.trailDotSize*2));
  if (typeof input.freeze === 'boolean') result.freeze = input.freeze;
  if (typeof input.phase === 'number' && Number.isFinite(input.phase)) result.phase = Math.max(0,Math.min(1,input.phase));
  if (typeof input.seed === 'number' && Number.isFinite(input.seed)) result.seed = Math.abs(Math.floor(input.seed)) % 2147483647;
  return result;
}

export function formatVisualValue(control,value) {
  if (control.type === 'color') return value.toUpperCase();
  if (['matrixGap','matrixValueSize','beadBreath'].includes(control.key)) return Math.round(value*100)+'%';
  if (control.type === 'text') return value;
  if (control.type === 'select') return control.options.find(([key])=>key===value)?.[1] || value;
  const digits = control.step >= 1 ? 0 : control.step < .01 ? 3 : 2;
  return Number(value).toFixed(digits).replace(/\.00$/,'') + (control.unit || '');
}

// Upgrade only the previous untouched built-in look. Saved edits, imported looks,
// sound settings and camera positions remain owned by the current session.
export function restoreSessionVisual(lookName, input, revision) {
  const oldDefault = lookName === 'signal' && revision === 5 && input &&
    Object.entries(PREVIOUS_SIGNAL_VISUAL).every(([key,value]) =>
      !Object.hasOwn(input,key) || input[key] === value);
  return oldDefault ? {...LOOKS.signal.visual} : sanitiseVisual(input, LOOKS[lookName].visual);
}
