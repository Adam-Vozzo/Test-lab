import {clamp,lerp,TAU,createSurface,bindPointers,label} from './kit.js';
import {MilkdropRenderer} from './milkdrop-renderer.js';

const FORMS=['flow','kaleido','tunnel','interference','plasma','orbit','lattice','spectral'];
const FORM_LABELS=['Fluid feedback','Kaleidoscope','Recursive tunnel','Wave interference','Plasma field','Orbital traces','Chromatic lattice','Spectral ribbons'];
const PALETTES=['prism','ice','ember','acid','silver'];
const BASE={fieldForm:'flow',palette:'prism',hue:.56,feedback:.88,warp:.6,motion:.5,scale:1,symmetry:5,lineWidth:1,detail:.65,exposure:1,colourSeparation:.25,response:1,zoom:.18,rotation:.15,mirror:0,raster:0};
const preset=(id,name,values)=>Object.freeze({id,name,appearance:Object.freeze({...BASE,...values})});

/** Original compositions. These are native feedback parameters, not .milk files. */
export const MILKDROP_PRESETS=Object.freeze([
  preset('prismatic-tide','Prismatic tide',{fieldForm:'flow',palette:'prism',hue:.54,feedback:.91,warp:.78,motion:.42,scale:1.1,detail:.78,colourSeparation:.32,rotation:.1}),
  preset('liquid-copper','Liquid copper',{fieldForm:'flow',palette:'ember',hue:.08,feedback:.94,warp:1.15,motion:.34,scale:1.6,lineWidth:1.6,detail:.42,exposure:.9,zoom:.12,rotation:-.16}),
  preset('hexagonal-prism','Hexagonal prism',{fieldForm:'kaleido',palette:'prism',hue:.72,feedback:.86,warp:.38,motion:.43,scale:.9,symmetry:6,lineWidth:.7,detail:.8,colourSeparation:.4,mirror:.88,rotation:.24}),
  preset('ice-mandala','Ice mandala',{fieldForm:'kaleido',palette:'ice',hue:.53,feedback:.93,warp:.65,motion:.3,scale:1.3,symmetry:10,lineWidth:1.3,detail:.54,mirror:1,zoom:-.15,rotation:-.13}),
  preset('recursive-gate','Recursive gate',{fieldForm:'tunnel',palette:'acid',hue:.2,feedback:.88,warp:.3,motion:.67,scale:.82,symmetry:4,lineWidth:.7,detail:.85,zoom:.8,rotation:.12,raster:.15}),
  preset('chromatic-vortex','Chromatic vortex',{fieldForm:'tunnel',palette:'prism',hue:.91,feedback:.95,warp:.72,motion:.46,scale:1.4,symmetry:8,lineWidth:1.5,detail:.5,colourSeparation:.65,zoom:.56,rotation:-.53}),
  preset('standing-waves','Standing waves',{fieldForm:'interference',palette:'ice',hue:.58,feedback:.72,warp:.25,motion:.28,scale:1.4,lineWidth:.6,detail:.95,colourSeparation:.12,zoom:0,rotation:0}),
  preset('moire-oscillator','Moiré oscillator',{fieldForm:'interference',palette:'silver',hue:.12,feedback:.89,warp:.8,motion:.36,scale:.7,symmetry:3,lineWidth:.55,detail:.88,mirror:.35,zoom:-.12,rotation:.17,raster:.22}),
  preset('ion-cloud','Ion cloud',{fieldForm:'plasma',palette:'prism',hue:.74,feedback:.87,warp:1.2,motion:.37,scale:1.45,lineWidth:1.8,detail:.45,exposure:.9,colourSeparation:.35,zoom:.08,rotation:-.1}),
  preset('solar-convection','Solar convection',{fieldForm:'plasma',palette:'ember',hue:.04,feedback:.94,warp:.85,motion:.25,scale:.73,lineWidth:2.1,detail:.78,exposure:.85,colourSeparation:.1,zoom:-.22,rotation:.08}),
  preset('orbital-ink','Orbital ink',{fieldForm:'orbit',palette:'silver',hue:.56,feedback:.95,warp:.28,motion:.38,scale:1.1,symmetry:3,lineWidth:.55,detail:.68,exposure:1.08,colourSeparation:.06,zoom:.06,rotation:.4}),
  preset('magnetic-loops','Magnetic loops',{fieldForm:'orbit',palette:'acid',hue:.31,feedback:.85,warp:.65,motion:.56,scale:.8,symmetry:8,lineWidth:1.25,detail:.9,colourSeparation:.35,zoom:-.24,rotation:-.32}),
  preset('diffraction-grid','Diffraction grid',{fieldForm:'lattice',palette:'prism',hue:.68,feedback:.79,warp:.4,motion:.42,scale:.76,symmetry:4,lineWidth:.6,detail:.95,colourSeparation:.5,zoom:.22,rotation:.08,raster:.28}),
  preset('circuit-weave','Circuit weave',{fieldForm:'lattice',palette:'acid',hue:.16,feedback:.91,warp:.92,motion:.3,scale:1.5,symmetry:6,lineWidth:1.2,detail:.55,colourSeparation:.12,mirror:.68,zoom:-.16,rotation:-.19,raster:.4}),
  preset('spectral-silk','Spectral silk',{fieldForm:'spectral',palette:'ice',hue:.48,feedback:.92,warp:.58,motion:.35,scale:1.2,symmetry:4,lineWidth:.8,detail:.78,colourSeparation:.2,zoom:.14,rotation:.05}),
  preset('phase-curtain','Phase curtain',{fieldForm:'spectral',palette:'ember',hue:.09,feedback:.82,warp:.95,motion:.52,scale:.7,symmetry:7,lineWidth:1.6,detail:.62,colourSeparation:.42,mirror:.8,zoom:-.2,rotation:-.08}),
  preset('bilateral-smoke','Bilateral smoke',{fieldForm:'flow',palette:'silver',hue:.6,feedback:.96,warp:.95,motion:.28,scale:.72,lineWidth:.65,detail:.8,colourSeparation:.07,mirror:1,zoom:.25,rotation:0}),
  preset('rose-window','Rose window',{fieldForm:'kaleido',palette:'ember',hue:.02,feedback:.9,warp:.85,motion:.32,scale:1.15,symmetry:12,lineWidth:.6,detail:.85,colourSeparation:.12,mirror:1,zoom:.1,rotation:.11})
]);

const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
  id:'milkdrop',name:'MilkDrop',layoutMode:'single',
  theme:{bg:'#05060a',fg:'#e9edf4',accent:'#a7e8e0',muted:'#818b9a'},
  defaultSound:{waveform:'wavetable',tablePosition:.24,tableWarp:.12,attack:.035,decay:.38,sustain:.62,release:1.35,cutoff:6800,resonance:1.15,detune:0,ratio:1.5,index:.12,gain:.62,pan:0,glide:.055,echo:.23,delayTime:.31,feedback:.3,expression:.8,sequenceMode:'drift',gate:.78},
  defaultAppearance:{...MILKDROP_PRESETS[0].appearance,autoCycle:false,cycleSeconds:24,morphSeconds:3,touchResponse:.7,showReadout:true},
  soundControls:[
    {key:'waveform',label:'Oscillator',kind:'select',options:[['wavetable','Wavetable'],['sine','Sine'],['triangle','Triangle'],['sawtooth','Saw'],['square','Pulse']],section:'Voice',description:'Source waveform. Wavetable continuously blends rounded and harmonic tones.'},
    range('tablePosition','Wavetable position',0,1,.01,'Voice','Shape of the wavetable oscillator; active when Oscillator is Wavetable.'),
    range('tableWarp','Wavetable harmonics',0,1,.01,'Voice','Harmonic deformation of the wavetable oscillator.'),
    range('index','FM depth',0,2,.01,'Voice','Amount of frequency modulation, from a rounded tone to a metallic edge.'),
    range('ratio','FM ratio',.5,4,.25,'Voice','Modulator frequency relative to the played note.','×'),
    range('glide','Pitch glide',.005,.3,.005,'Expression','Time to move between scale notes while dragging.','s'),
    range('expression','Vertical expression',0,1,.01,'Expression','Depth of touch-height control over filter cutoff and wavetable position.'),
    range('echo','Delay level',0,.45,.01,'Delay','Level of the stereo echo added after the voices.'),
    range('delayTime','Delay time',.08,.75,.01,'Delay','Time between audible repeats.','s'),
    range('feedback','Delay feedback',0,.65,.01,'Delay','Amount of sound returned through the delay, controlling repeat length.'),
    {key:'sequenceMode',label:'Pattern',kind:'select',options:[['drift','Drift'],['pulse','Pulse'],['chords','Chords']],section:'Sequence',description:'Notes generated by Play. Direct touches and held notes remain independent.'},
    range('gate','Step duration',.15,1.5,.01,'Sequence','Duration of sequenced notes relative to a sixteenth-note step.','×')
  ],
  appearanceControls:[
    {key:'fieldForm',label:'Field geometry',kind:'select',options:FORMS.map((id,i)=>[id,FORM_LABELS[i]]),section:'Field',description:'Geometry drawn into the feedback field; each form has a different motion and audio mapping.'},
    range('scale','Pattern scale',.4,2,.01,'Field','Size of the source pattern before it enters the feedback loop.','×'),
    range('detail','Pattern detail',0,1,.01,'Field','Number and intricacy of curves, cells or bands in the selected geometry.'),
    range('symmetry','Radial divisions',2,12,1,'Field','Number of repeated sectors in radial and kaleidoscopic forms.'),
    range('lineWidth','Source width',.3,2.5,.05,'Field','Thickness of the new traces injected into the field.','×'),
    range('feedback','Trail persistence',0,.98,.01,'Feedback','How much of each previous frame survives into the next. Higher values make longer trails.'),
    range('warp','Flow distortion',0,1.5,.01,'Feedback','Curvature of the flow that transports and deforms the previous frame.'),
    range('motion','Flow speed',0,2,.01,'Feedback','Ambient speed of the feedback field. Zero stops autonomous drift.','×'),
    range('zoom','Radial flow',-1,1,.01,'Feedback','Direction and speed of image recirculation. Negative draws inward; positive moves outward.'),
    range('rotation','Flow rotation',-1,1,.01,'Feedback','Signed rotation of recirculating image history.'),
    range('mirror','Mirror blend',0,1,.01,'Feedback','Blend between the continuous field and mirrored feedback sampling.'),
    {key:'palette',label:'Colour mapping',kind:'select',options:[['prism','Prism'],['ice','Ice'],['ember','Ember'],['acid','Acid'],['silver','Silver']],section:'Colour',description:'Colour relationship used for source traces, waveform energy and feedback.'},
    range('hue','Hue rotation',0,1,.01,'Colour','Rotation of the selected colour mapping through its hue cycle.'),
    range('colourSeparation','Channel separation',0,1,.01,'Colour','Distance between red, green and blue feedback samples.'),
    range('exposure','Field exposure',.4,1.8,.01,'Colour','Overall brightness of the generated field, with highlights kept bounded.','×'),
    range('raster','Scanline texture',0,1,.01,'Colour','Subtle raster modulation of the field; interface text remains unchanged.'),
    range('response','Audio response',0,2,.01,'Response','Amount by which measured output volume and spectrum deform the field.','×'),
    range('touchResponse','Touch displacement',0,1.5,.01,'Response','Strength of local feedback displacement around each held finger.'),
    {key:'autoCycle',label:'Cycle effects',kind:'toggle',section:'Transitions',description:'Automatically advance through all effects while this instrument is visible.'},
    range('cycleSeconds','Effect duration',8,120,1,'Transitions','Seconds before automatic cycling begins the next effect.','s'),
    range('morphSeconds','Transition duration',.25,12,.25,'Transitions','Time taken to blend field geometry, colour and flow when changing effects.','s'),
    {key:'showReadout',label:'Interaction readout',kind:'toggle',section:'Readout',description:'Show the pitch/filter axis labels, active note and measured output level.'}
  ]
};

const numericKeys=Object.keys(BASE).filter(key=>typeof BASE[key]==='number');
const presetKeys=Object.keys(BASE);
export function milkdropPresetIndex(appearance){return MILKDROP_PRESETS.findIndex(p=>presetKeys.every(key=>typeof p.appearance[key]==='number'?Math.abs((appearance[key]??NaN)-p.appearance[key])<.00001:appearance[key]===p.appearance[key]));}
export function milkdropTouch(nx,ny,sound=definition.defaultSound,scale='dorian'){
  const x=clamp(nx),y=clamp(ny),depth=clamp(sound.expression??.8),baseCutoff=clamp(sound.cutoff??6800,120,18000);
  const scaleLength=scale==='chromatic'?12:scale==='pentatonic'?5:7;
  return{degree:Math.round(x*scaleLength*2),cutoff:clamp(baseCutoff*2**((.5-y)*4*depth),120,18000),tablePosition:clamp((sound.tablePosition??.24)+(.5-y)*.6*depth),pan:(x-.5)*.55,velocity:.88};
}
export function milkdropParams(appearance){
  const params={};for(const key of numericKeys)params[key]=Number.isFinite(appearance[key])?appearance[key]:BASE[key];
  params.family=Math.max(0,FORMS.indexOf(appearance.fieldForm));params.palette=Math.max(0,PALETTES.indexOf(appearance.palette));return params;
}
export function milkdropMorph(from,to,progress){
  const p=clamp(progress),u=p*p*(3-2*p),params={...to};
  for(const key of numericKeys)params[key]=lerp(from[key]??to[key],to[key],u);
  // Hue is circular: crossing 0/1 must take the short path through red.
  const hueDelta=((to.hue-from.hue+.5)%1+1)%1-.5;params.hue=((from.hue+hueDelta*u)%1+1)%1;
  params.familyFrom=from.family;params.familyMix=u;params.paletteFrom=from.palette;params.paletteMix=u;return params;
}
export function milkdropSequence(step,mode='drift'){
  const index=((Math.floor(step)%16)+16)%16;
  if(mode==='chords')return index%4===0?[{degree:[0,3,4,1][index/4],octave:-1,gain:.48},{degree:[2,5,6,3][index/4],octave:0,gain:.32},{degree:[4,7,8,5][index/4],octave:0,gain:.28}]:[];
  if(mode==='pulse')return[{degree:[0,4,7,4,2,5,9,5,3,7,10,7,1,5,8,5][index],octave:0,gain:index%4===0?.55:.35}];
  const notes=[];if(index%2===0)notes.push({degree:[0,4,2,6,3,7,5,2][index/2],octave:0,gain:.45});
  if(index%8===0)notes.push({degree:index===0?0:3,octave:-1,gain:.42});return notes;
}

const svg=(path)=>`<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${path}"/></svg>`;
const icons={previous:svg('m12 5-5 5 5 5'),next:svg('m8 5 5 5-5 5'),random:svg('M3 5h2c4 0 6 10 10 10h2m-3-3 3 3-3 3M3 15h2c1.5 0 2.7-1.3 4-3.4M11 8.4C12.3 6.3 13.5 5 15 5h2m-3-3 3 3-3 3'),cycle:svg('M16 7a6 6 0 0 0-10-2L3 8m0-4v4h4m-3 5a6 6 0 0 0 10 2l3-3m0 4v-4h-4'),clear:svg('M4 6h12M8 3h4M6 6l1 11h6l1-11')};

export function mount(host,api){
  const wrapper=document.createElement('div');wrapper.className='milkdrop-root';
  wrapper.innerHTML=`<style>
    .milkdrop-root{position:absolute;inset:0;overflow:hidden;background:#05060a;isolation:isolate;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .milkdrop-play-surface{position:absolute!important;inset:0;z-index:2;cursor:crosshair;-webkit-user-select:none;user-select:none}
    .milkdrop-toolbar{position:absolute;top:12px;left:14px;right:14px;z-index:3;display:flex;align-items:center;gap:5px;pointer-events:none}
    .milkdrop-toolbar button,.milkdrop-toolbar select{pointer-events:auto;box-sizing:border-box;min-height:42px;font:inherit;color:#dce5ed;border:1px solid #b6d0e331;border-radius:3px;background:#05070cba;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);touch-action:manipulation}
    .milkdrop-toolbar button{width:42px;min-width:42px;display:grid;place-items:center;padding:9px;cursor:pointer}
    .milkdrop-toolbar button:hover{background:#1d2639c9;border-color:#b6d0e36b}
    .milkdrop-toolbar button[aria-pressed=true]{color:#a7e8e0;background:#123a3ad9;border-color:#82cfc980}
    .milkdrop-toolbar :focus-visible{outline:2px solid #c5f7eb;outline-offset:2px}
    .milkdrop-toolbar svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
    .milkdrop-toolbar select{font-size:11px;letter-spacing:.025em;min-width:160px;width:212px;max-width:35vw;padding:0 28px 0 12px;cursor:pointer}
    .milkdrop-toolbar option{background:#0c101a;color:#edf4fa}
    .milkdrop-toolbar [data-milkdrop-action=clear]{margin-left:auto}
    .milkdrop-counter{color:#9caebf;font-size:9px;letter-spacing:.08em;min-width:46px;text-align:center;pointer-events:none;text-shadow:0 1px 5px #000}
    .milkdrop-progress{position:absolute;bottom:0;left:0;right:0;z-index:3;height:1px;background:transparent;pointer-events:none}
    .milkdrop-progress i{display:block;width:100%;height:100%;background:#c1eee370;transform-origin:left;transform:scaleX(0)}
    @media(max-width:620px){.milkdrop-toolbar{top:8px;left:8px;right:8px;gap:3px}.milkdrop-toolbar select{min-width:0;flex:1;width:auto;max-width:none;font-size:11px;padding-left:8px;padding-right:18px}.milkdrop-toolbar button{width:40px;min-width:40px;min-height:42px;padding:9px}.milkdrop-counter{display:none}}
    @media(max-width:460px){.milkdrop-toolbar [data-milkdrop-action=random]{display:none}}
    @media(pointer:coarse){.milkdrop-toolbar select{font-size:16px;letter-spacing:-.045em}}
    @media(prefers-reduced-motion:reduce){.milkdrop-toolbar *{transition:none!important}}
  </style><div class="milkdrop-toolbar" role="group" aria-label="Visual effects">
    <button type="button" data-milkdrop-action="previous" title="Previous effect" aria-label="Previous effect">${icons.previous}</button>
    <select data-milkdrop-preset aria-label="Visual effect">${MILKDROP_PRESETS.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}<option value="custom" disabled>Custom</option></select>
    <button type="button" data-milkdrop-action="next" title="Next effect" aria-label="Next effect">${icons.next}</button>
    <button type="button" data-milkdrop-action="random" title="Random effect" aria-label="Random effect">${icons.random}</button>
    <button type="button" data-milkdrop-action="cycle" title="Cycle effects" aria-label="Cycle effects" aria-pressed="false">${icons.cycle}</button>
    <span class="milkdrop-counter" aria-hidden="true"></span>
    <button type="button" data-milkdrop-action="clear" title="Clear feedback history" aria-label="Clear feedback history">${icons.clear}</button>
  </div><div class="milkdrop-progress" aria-hidden="true"><i></i></div>`;
  host.append(wrapper);
  const renderer=new MilkdropRenderer(wrapper,{});
  const surface=createSurface(wrapper,{label:'MilkDrop. Drag horizontally to play scale notes, vertically to change filter brightness. Touches displace the feedback field.'});surface.canvas.classList.add('milkdrop-play-surface');
  const c=surface.ctx,select=wrapper.querySelector('[data-milkdrop-preset]'),counter=wrapper.querySelector('.milkdrop-counter'),cycleButton=wrapper.querySelector('[data-milkdrop-action=cycle]'),progress=wrapper.querySelector('.milkdrop-progress i');
  const contacts=new Map(),markers=new Map(),abort=new AbortController();let disposed=false,clock=0,cycleElapsed=0,lastPreset=0,lastWidth=0,lastHeight=0,lastDpr=0,voiceSerial=0,lastReadout=0;
  let target=milkdropParams({...definition.defaultAppearance,...api.state.appearance}),current={...target},transitionFrom={...target},transitionElapsed=1e6,transitionDuration=3;
  const appearance=()=>({...definition.defaultAppearance,...api.state.appearance});
  function sync(){const a=appearance(),index=milkdropPresetIndex(a);if(index>=0)lastPreset=index;select.value=index>=0?MILKDROP_PRESETS[index].id:'custom';counter.textContent=index>=0?`${String(index+1).padStart(2,'0')} / ${MILKDROP_PRESETS.length}`:'CUSTOM';cycleButton.setAttribute('aria-pressed',String(Boolean(a.autoCycle)));}
  function changeAppearance(patch,history=true){if(api.setAppearance)api.setAppearance(patch,{history});else{Object.assign(api.state.appearance,patch);update(null,'appearance');api.save();}}
  function choose(index,history=true){lastPreset=((index%MILKDROP_PRESETS.length)+MILKDROP_PRESETS.length)%MILKDROP_PRESETS.length;cycleElapsed=0;changeAppearance(MILKDROP_PRESETS[lastPreset].appearance,history);}
  wrapper.querySelector('.milkdrop-toolbar').addEventListener('click',event=>{const action=event.target.closest('[data-milkdrop-action]')?.dataset.milkdropAction;if(!action)return;if(action==='previous')choose(lastPreset-1);if(action==='next')choose(lastPreset+1);if(action==='random')choose(lastPreset+1+Math.floor(Math.random()*(MILKDROP_PRESETS.length-1)));if(action==='cycle'){cycleElapsed=0;changeAppearance({autoCycle:!appearance().autoCycle});}if(action==='clear')renderer.reset();},{signal:abort.signal});
  select.addEventListener('change',()=>{const index=MILKDROP_PRESETS.findIndex(p=>p.id===select.value);if(index>=0)choose(index);},{signal:abort.signal});
  function soundFor(p){const touch=milkdropTouch(p.nx,p.ny,api.state.sound,api.state.scale);return{...api.state.sound,...touch,gain:api.state.sound.gain??.62};}
  function noteFor(p){return api.quantize(milkdropTouch(p.nx,p.ny,api.state.sound,api.state.scale).degree);}
  function place(p,q){const elapsed=Math.max(.012,Math.min(.1,clock-(q.time??clock))),vx=(p.nx-q.x)/elapsed,vy=(p.ny-q.y)/elapsed;Object.assign(q,{x:p.nx,y:p.ny,pressure:clamp(p.pressure||.6,.2,1),vx:clamp(vx,-3,3),vy:clamp(vy,-3,3),time:clock,midi:noteFor(p),nx:p.nx,ny:p.ny});}
  const unbind=bindPointers(surface.canvas,{
    down(p){if(contacts.size>=8)return false;const q={id:`milkdrop-touch-${++voiceSerial}`,x:p.nx,y:p.ny,time:clock,vx:0,vy:0,held:true};place(p,q);contacts.set(p.id,q);markers.set(q.id,q);api.noteOn(q.id,q.midi,soundFor(p));},
    move(p){const q=contacts.get(p.id);if(!q)return;place(p,q);api.noteUpdate(q.id,q.midi,soundFor(p));},
    up(p){const q=contacts.get(p.id);if(!q)return;q.held=false;q.latched=Boolean(api.state.hold);q.released=clock;api.noteOff(q.id);contacts.delete(p.id);},
    cancel(p){const q=contacts.get(p.id);if(!q)return;(api.noteCancel||api.noteOff)(q.id);markers.delete(q.id);contacts.delete(p.id);}
  });
  function update(key,kind){
    if(kind==='appearance'||!kind){const a=appearance(),next=milkdropParams(a);if(JSON.stringify(next)!==JSON.stringify(target)){transitionFrom={...current,family:current.familyMix<.5?current.familyFrom:current.family,palette:current.paletteMix<.5?current.paletteFrom:current.palette};target=next;transitionElapsed=0;transitionDuration=key&&key!=='fieldForm'&&key!=='palette'?.12:Math.max(.25,a.morphSeconds);}cycleElapsed=0;sync();}
    if(kind==='sound'||kind==='performance')for(const q of markers.values())if(q.held||api.state.hold){q.midi=noteFor(q);api.noteUpdate(q.id,q.midi,soundFor(q));}
  }
  function cancel(){for(const q of markers.values())(api.noteCancel||api.noteOff)(q.id);contacts.clear();markers.clear();}
  function frame(time,dt){
    if(disposed)return;clock+=clamp(dt,0,.1);surface.resize();const w=surface.width,h=surface.height,a=appearance(),snap=api.audio.snapshot();
    if(w!==lastWidth||h!==lastHeight||surface.dpr!==lastDpr){lastWidth=w;lastHeight=h;lastDpr=surface.dpr;renderer.resize(w,h,surface.dpr);}
    if(a.autoCycle&&!api.reducedMotion){cycleElapsed+=clamp(dt,0,.1);if(cycleElapsed>=Math.max(8,a.cycleSeconds))choose(lastPreset+1,false);}
    transitionElapsed+=clamp(dt,0,.1);const morph=api.reducedMotion?1:clamp(transitionElapsed/transitionDuration);current=milkdropMorph(transitionFrom,target,morph);
    const voices=snap.voices||[],inputs=[];
    for(const[id,q]of markers){if(!api.state.hold)q.latched=false;const voice=voices.find(v=>v.id===id&&v.level>.002),latched=q.latched&&(api.audio.sources?.has(id)??true),life=q.held||latched?1:voice?Math.max(.2,Math.min(1,voice.level)):Math.max(0,1-(clock-(q.released??clock))/1.2);q.life=life;if(life<=0){markers.delete(id);continue;}q.vx*=Math.exp(-dt*8);q.vy*=Math.exp(-dt*8);if(inputs.length<4)inputs.push({x:q.x,y:q.y,pressure:clamp(q.pressure*life*a.touchResponse,0,1.5),vx:q.vx*a.touchResponse,vy:q.vy*a.touchResponse});}
    renderer.frame({time:clock,dt,waveform:snap.waveform,frequency:snap.frequency,rms:snap.rms,params:current,pointers:inputs,reducedMotion:api.reducedMotion});
    c.clearRect(0,0,w,h);
    for(const q of markers.values()){const life=q.life??1;if(life<.02)continue;const x=q.x*w,y=q.y*h,r=9+Math.min(1,life)*5;c.save();c.globalAlpha=clamp(life*.8,.1,.8);c.strokeStyle='#e2fff3';c.lineWidth=.7;c.beginPath();c.arc(x,y,r,0,TAU);c.moveTo(x-r-5,y);c.lineTo(x-r+1,y);c.moveTo(x+r-1,y);c.lineTo(x+r+5,y);c.moveTo(x,y-r-5);c.lineTo(x,y-r+1);c.moveTo(x,y+r-1);c.lineTo(x,y+r+5);c.stroke();if(a.showReadout){c.shadowColor='#000';c.shadowBlur=5;label(c,api.noteName(q.midi),x+r+6,y-1,'#dffbf2',10);}c.restore();}
    if(a.showReadout){const bottom=h-17,pad=w<620?12:20;c.save();c.shadowColor='#000';c.shadowBlur=7;label(c,w<620?'X PITCH · Y FILTER':'X / SCALE PITCH     Y / FILTER BRIGHTNESS',pad,bottom,'#b8c7d0',w<620?8:9);const level=snap.rms>.0001?`${Math.max(-80,20*Math.log10(snap.rms)).toFixed(1)} dB`:'−∞ dB',active=voices.filter(v=>v.level>.002).length;label(c,`${active} VOICES · ${level}`,w-pad,bottom,'#a8bac7',w<620?8:9,'right');c.restore();}
    progress.style.transform=`scaleX(${a.autoCycle&&!api.reducedMotion?clamp(cycleElapsed/a.cycleSeconds):0})`;
    if(clock-lastReadout>.5){lastReadout=clock;sync();}
  }
  sync();
  return{
    frame,update,cancel,
    onStep(step,when){const s=api.state.sound,notes=milkdropSequence(step,s.sequenceMode),duration=60/api.state.bpm/4*(s.gate??.78)*(s.sequenceMode==='chords'?4:1);notes.forEach((n,i)=>api.audio.pulse(`milkdrop-sequence-${step}-${i}`,api.quantize(n.degree,n.octave),{...s,gain:(s.gain??.62)*n.gain/.55,pan:notes.length>1?(i-(notes.length-1)/2)*.22:Math.sin(step*.7)*.18,velocity:.85},when,duration));},
    getData(){return{version:1,lastPreset:MILKDROP_PRESETS[lastPreset].id};},
    setData(data){if(data?.version!==1)return;const index=MILKDROP_PRESETS.findIndex(p=>p.id===data.lastPreset);if(index>=0)lastPreset=index;sync();},
    destroy(){if(disposed)return;disposed=true;unbind();cancel();abort.abort();renderer.destroy();surface.destroy();wrapper.remove();}
  };
}
