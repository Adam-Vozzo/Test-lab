import {AudioEngine,degreeToMidi,SCALES} from './audio.js';
import {RingScene} from './ring.js';
import {createAppearance} from './appearance.js';
import {LOOKS,DEFAULT_VISUAL,sanitiseVisual,restoreSessionVisual} from './visual-config.js';
import {setupPWA} from './pwa.js';
import {SignalField} from './signal-field.js';
import {GalaxyScene} from './galaxy.js';
import {enableSecondaryButtonTaps} from './touch-controls.js';
import {createFloatingPanels} from './floating-panels.js';
import {createTempoControl} from './tempo-control.js';
import {enableRangeScrubbing} from './range-scrub.js';
const UI_FONT = getComputedStyle(document.documentElement).getPropertyValue('--ui-font').trim() || 'monospace';

const $=id=>document.getElementById(id), clamp=(x,a,b)=>Math.min(b,Math.max(a,x)), TAU=Math.PI*2;
const STORAGE='duo.session.v1';
const defaultSound={waveform:'triangle',detune:8,attack:.04,decay:.35,sustain:.55,release:1.4,cutoff:2400,resonance:4.5,delay:.22,feedback:.25,reverb:.22,volume:.65,lfoRate:.35,lfoDepth:.08};
const melody=[0,2,4,2,3,6,4,2,3,1,0,2,4,6,4,3];
const makeSteps=()=>melody.map((note,i)=>({note,velocity:i%4===0?.85:.65,active:![3,10].includes(i)}));
const defaultSequence={bpm:112,swing:.1,root:50,scale:'dorian',length:16,steps:makeSteps(),arp:false,arpRate:8,arpDirection:'up'};
const state={sound:{...defaultSound},sequence:{...defaultSequence,steps:makeSteps()},look:'signal',visual:{...LOOKS.signal.visual},visualRevision:6,ringCamera:{yaw:0,pitch:0,zoom:1},hold:false,playing:false,step:0};
function validateSession(data){
 if(!data||typeof data!=='object')throw new Error('Invalid session');
 const sound={...defaultSound}; const bounds={detune:[0,40],attack:[.005,2],decay:[.05,2],sustain:[0,1],release:[.05,5],cutoff:[20,20000],resonance:[.1,12],delay:[0,.65],feedback:[0,.7],reverb:[0,.65],volume:[0,1],lfoRate:[.05,4],lfoDepth:[0,1]};
 for(const [k,[a,b]]of Object.entries(bounds)){const v=data.sound?.[k];if(Number.isFinite(v))sound[k]=clamp(v,a,b);}
 if(['triangle','sine','sawtooth','square'].includes(data.sound?.waveform))sound.waveform=data.sound.waveform;
 const sequence={...defaultSequence,steps:makeSteps()},s=data.sequence||{};
 for(const [k,a,b] of [['bpm',40,220],['swing',0,.45],['root',48,59]])if(Number.isFinite(s[k]))sequence[k]=clamp(s[k],a,b);
 if(Object.hasOwn(SCALES,s.scale))sequence.scale=s.scale;
 if([8,12,16].includes(s.length))sequence.length=s.length;
 if([4,8,16].includes(s.arpRate))sequence.arpRate=s.arpRate;
 if(['up','down','upDown','random'].includes(s.arpDirection))sequence.arpDirection=s.arpDirection;
 sequence.arp=!!s.arp;
 if(Array.isArray(s.steps)&&s.steps.length===16)sequence.steps=s.steps.map((v,i)=>({note:Number.isFinite(v?.note)?Math.round(clamp(v.note,0,14)):melody[i],velocity:Number.isFinite(v?.velocity)?clamp(v.velocity,.1,1):.7,active:typeof v?.active==='boolean'?v.active:true}));
 const look=Object.hasOwn(LOOKS,data.look)?data.look:'signal';
 const view=data.ringCamera||{},ringCamera={yaw:Number.isFinite(view.yaw)?view.yaw:0,pitch:Number.isFinite(view.pitch)?view.pitch:0,zoom:Number.isFinite(view.zoom)?clamp(view.zoom,.5,2.5):1};
 return{sound,sequence,look,visual:restoreSessionVisual(look,data.visual,data.visualRevision),ringCamera};
}
try{const saved=localStorage.getItem(STORAGE);if(saved){const data=JSON.parse(saved);Object.assign(state,validateSession(data));if((data.visualRevision||0)<2){
 const looks=JSON.parse(localStorage.getItem('duo-visual-looks-v1')||'[]');
 if(Array.isArray(looks)&&!looks.some(v=>v.id==='before-signal-v2')){looks.push({id:'before-signal-v2',name:'Before Signal · '+(LOOKS[state.look]?.name||'Custom'),look:state.look,visual:{...state.visual}});localStorage.setItem('duo-visual-looks-v1',JSON.stringify(looks));}
 state.look='signal';state.visual={...LOOKS.signal.visual};
}if((data.visualRevision||0)<4){if((data.visualRevision||0)>=2)state.visual.scale=clamp(state.visual.scale*.84,.5,1.25);}if((data.visualRevision||0)<5&&data.visual?.beadBreath===.08)state.visual.beadBreath=.14;}}catch{}
if(state.sound.volume===0)state.sound.volume=defaultSound.volume;
let saveTimer,toastTimer,notePulse=0,lastNote=50,lastParameterGesture=null;
function recordParameter(key,value){lastParameterGesture={key,value,at:performance.now()/1000};}
const livePointers=new Map(),keys=new Set();
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(STORAGE,JSON.stringify({version:1,visualRevision:6,sound:state.sound,sequence:state.sequence,look:state.look,visual:state.visual,ringCamera:state.ringCamera}));}catch{}},250);}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2600);}
function updateRange(el){const min=Number(el.min)||0,max=Number(el.max)||1;el.style.setProperty('--fill',`${clamp((Number(el.value)-min)/(max-min),0,1)*100}%`);}
const noteName=midi=>['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][((midi%12)+12)%12]+(Math.floor(midi/12)-1);
function markNote(note,velocity=.7,info){lastNote=note;notePulse=Math.max(notePulse,velocity);$('current-note').textContent=noteName(note);}
const engine=new AudioEngine(()=>state,{onStep:i=>{state.step=Math.max(0,i);updateStepMarker();},onNote:markNote,onState:(status,message)=>{if(status==='error')toast(message||'Tap Play to enable audio');if(status==='suspended'||status==='closed'){state.playing=false;updateTransport();}}});
function palette(){const base=LOOKS[state.look].palette;return{...base,reference:state.look==='signal',bg:state.visual.bg,fg:state.visual.fg,accent:state.visual.accent,secondary:state.visual.secondary};}
function applyVisual(){const p=palette(),v=state.visual,style=document.documentElement.style;for(const k of ['bg','fg','accent','secondary','muted'])style.setProperty('--'+k,p[k]);document.documentElement.classList.toggle('reference',state.look==='signal');style.setProperty('--panel',p.bg);style.setProperty('--line',hexAlpha(p.accent,.2));style.setProperty('--centre-gap',`${v.centreGap}px`);style.setProperty('--label-scale',v.labelScale);style.setProperty('--text-tracking',(v.textTracking??0)+'em');document.documentElement.dataset.copy=v.copyVisibility||'full';document.querySelectorAll('[data-copy]').forEach(el=>{const text=v[el.dataset.copy];if(typeof text==='string')el.textContent=text;});document.documentElement.style.colorScheme=state.look==='vellum'?'light':'dark';document.querySelector('meta[name=theme-color]').content=p.bg;document.title=`DUO — ${LOOKS[state.look].name}`;}
function setVisual(v){state.visual=sanitiseVisual(v,state.visual);applyVisual();save();}
function setLook(name){if(!LOOKS[name])return;state.look=name;state.visual={...LOOKS[name].visual};applyVisual();appearance.refresh();save();}
applyVisual();
const scene=new RingScene($('ring-host'),{getVisual:()=>state.visual,getPalette:palette,getActivity:activity,cameraView:state.ringCamera,onCameraChange:view=>{state.ringCamera=view;save();}});
const galaxy=new GalaxyScene($('sky-stage'),{getVisual:()=>state.visual,getPalette:palette,getSound:()=>state.sound,getActivity:activity,onChange:values=>{Object.assign(state.sound,values);recordParameter('galaxy',values);engine.update();syncSound();save();}});
function activity(){
 const a=engine.getVisualState?.()||{time:performance.now()/1000,voices:[],level:engine.getLevel(),lfoPhase:0};
 // Pointer provenance comes from each scheduled audio snapshot, including arp
 // pulses and release tails; current pooled-slot ownership can already differ.
 return{...a,energy:a.level,note:lastNote,playing:state.playing||livePointers.size>0||keys.size>0,cutoff:a.cutoff??state.sound.cutoff,resonance:state.sound.resonance,sound:{...state.sound},sequence:{...state.sequence,step:state.step},sequencePlaying:state.playing,hold:state.hold,parameterGesture:lastParameterGesture};
}
let anchorCache=null,anchorTime=0;
const anchorObserver=new ResizeObserver(()=>{anchorCache=null;});
for(const id of ['sky-stage','sequence-grid','ring-host'])anchorObserver.observe($(id));
function signalAnchors(){
 const now=performance.now(),host=document.querySelector('.workspace');
 if(!anchorCache||now-anchorTime>80){const bounds=host.getBoundingClientRect();const box=id=>{const r=$(id).getBoundingClientRect();return{x:r.left-bounds.left,y:r.top-bounds.top,w:r.width,h:r.height};};anchorCache={sky:box('sky-stage'),sequence:box('sequence-grid'),ring:box('ring-host'),portrait:matchMedia('(max-width:640px) and (orientation:portrait)').matches};anchorTime=now;}
 const a=anchorCache,crosshair=galaxy.projectCrosshair(),filter={x:a.sky.x+crosshair.x,y:a.sky.y+crosshair.y};
 const steps=a.sequence.h>0?state.sequence.steps.slice(0,state.sequence.length).map((s,i)=>({x:a.sequence.x+(i+.5)*a.sequence.w/state.sequence.length,y:a.sequence.y+a.sequence.h-10-(s.note/14)*(a.sequence.h-20)})):[];
 const sector=i=>{const p=scene.projectSector?.(i)||{x:a.ring.w*.5+Math.cos(i/8*TAU)*a.ring.w*.3,y:a.ring.h*.5+Math.sin(i/8*TAU)*a.ring.h*.22};return{x:a.ring.x+p.x,y:a.ring.y+p.y};};
 const core=scene.projectCore?.()||{x:a.ring.w*.5,y:a.ring.h*.5};
 const filterWorld=galaxy.cursor.toArray();
 // Project both world positions through the current camera so navigation
 // changes the view without injecting a false impulse into the elastic field.
 const projectFilterWorld=world=>{const p=galaxy.project(galaxy.cursor.clone().set(...world));return{x:a.sky.x+p.x,y:a.sky.y+p.y};};
 return{...a,filter,filterWorld,projectFilterWorld,steps,sectors:Array.from({length:8},(_,i)=>sector(i)),core:{x:a.ring.x+core.x,y:a.ring.y+core.y}};
}
const signalField=new SignalField(document.querySelector('.workspace'),{getVisual:()=>state.visual,getPalette:palette,getActivity:activity,getAnchors:signalAnchors});
scene.setParticleLayerProvider(now=>signalField.updateParticleLayer(now));
const tempoControl=createTempoControl($('tempo-control'));
const signalRanges=enableRangeScrubbing();
const pwa=setupPWA({isPlaying:()=>state.playing||livePointers.size>0||keys.size>0||state.hold||ringGestures.size>0||galaxy.dragging||floatingPanels.dragging||tempoControl.active||signalRanges.active,onToast:toast});
const appearance=createAppearance($('appearance'),{getVisual:()=>state.visual,setVisual,getLook:()=>state.look,setLook,onToast:toast,getFullscreen:()=>({available:pwa.canFullscreen,active:pwa.fullscreen}),onFullscreen:()=>pwa.toggleFullscreen()});

function updateTransport(){$('play').classList.toggle('playing',state.playing);$('play').setAttribute('aria-label',state.playing?'Pause sequence':'Play sequence');$('play').innerHTML=state.playing?'<svg viewBox="0 0 20 20"><path d="M6 4h3v12H6ZM12 4h3v12h-3Z"/></svg>':'<svg viewBox="0 0 20 20"><path d="M7 4 16 10 7 16Z"/></svg>';$('hold').setAttribute('aria-pressed',state.hold);$('arp').setAttribute('aria-pressed',state.sequence.arp);window.dispatchEvent(new Event('duo:transport'));}
let playRequest=0;
async function togglePlay(){const request=++playRequest;if(state.playing){state.playing=false;engine.stopSequence();updateTransport();return;}state.playing=true;updateTransport();const ready=await engine.start();if(request!==playRequest)return;if(!ready){state.playing=false;updateTransport();toast('Tap Play to enable audio');}}
function panic(){playRequest++;state.playing=false;state.hold=false;livePointers.clear();keys.clear();ringGestures.clear();ringPoints.clear();ringPinch=null;scene.cancelOrbit();scene.clearContacts();$('ring-stage').style.cursor='grab';engine.stop();engine.allNotesOff();notePulse=0;updateTransport();}
$('play').addEventListener('click',togglePlay);
$('bpm').addEventListener('change',()=>{$('bpm').value=state.sequence.bpm;});
$('hold').addEventListener('click',()=>{state.hold=!state.hold;if(!state.hold){const physical=new Set([...livePointers.keys()].map(id=>'pointer-'+id).concat([...keys].map(key=>'key-'+key)));for(const id of engine.live.keys())if(!physical.has(id))engine.noteOff(id);}updateTransport();});
$('arp').addEventListener('click',()=>{state.sequence.arp=!state.sequence.arp;engine.update();updateTransport();save();});
for(const [id,key]of [['bpm','bpm'],['root','root'],['scale','scale'],['sequence-length','length'],['swing','swing'],['arp-rate','arpRate'],['arp-direction','arpDirection']])$(id).addEventListener('input',e=>{let value=['scale','arpDirection'].includes(key)?e.target.value:Number(e.target.value);if(key==='bpm')value=clamp(value,40,220);state.sequence[key]=value;recordParameter(key,value);engine.update();syncKey();if(key==='swing')$('swing-value').textContent=Math.round(value*100)+'%';if(key==='length')buildSteps();updateRange(e.target);save();});

const cutoffFromX=x=>20*1000**clamp(x,0,1),cutoffX=()=>Math.log(state.sound.cutoff/20)/Math.log(1000);
function formatSound(key,v){if(key==='lfoRate')return v.toFixed(2)+' Hz';if(key==='lfoDepth')return Math.round(v*100)+'%';if(key==='cutoff')return v>=1000?(v/1000).toFixed(1)+'k Hz':Math.round(v)+' Hz';if(['attack','decay','release'].includes(key))return v<1?Math.round(v*1000)+'ms':v.toFixed(2)+'s';if(['sustain','delay','feedback','reverb','volume'].includes(key))return Math.round(v*100)+'%';if(key==='detune')return Math.round(v)+' ct';return v.toFixed(2);}
function syncSound(){for(const el of document.querySelectorAll('[data-sound]')){const key=el.dataset.sound;el.value=key==='cutoff'?cutoffX():state.sound[key];if(el.type==='range')updateRange(el);for(const out of document.querySelectorAll('[data-sound-output="'+key+'"],#'+key+'-value'))out.textContent=formatSound(key,state.sound[key]);}document.querySelectorAll('[data-waveform]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.waveform===state.sound.waveform));$('cutoff-readout').textContent=state.sound.cutoff>=1000?(state.sound.cutoff/1000).toFixed(2)+'k':Math.round(state.sound.cutoff);$('res-readout').textContent=state.sound.resonance.toFixed(2);$('sky-x-value').textContent=formatSound('cutoff',state.sound.cutoff);$('sky-y-value').textContent=state.sound.resonance.toFixed(2)+' Q';$('sky-z-value').textContent=formatSound('detune',state.sound.detune);$('envelope-values').innerHTML=`A ${formatSound('attack',state.sound.attack)} <span>R ${formatSound('release',state.sound.release)}</span>`;}
function soundChange(key,value){state.sound[key]=value;recordParameter(key,value);engine.update();syncSound();save();}
const advanced=[['waveform','Waveform','select'],['detune','Detune',0,40,1],['decay','Decay',.05,2,.01],['sustain','Sustain',0,1,.01],['delay','Delay',0,.65,.01],['feedback','Feedback',0,.7,.01],['reverb','Reverb',0,.65,.01],['lfoRate','LFO rate',.05,4,.01],['lfoDepth','LFO depth',0,1,.01]];
for(const [key,label,min,max,step]of advanced){const el=document.createElement('label');el.className='advanced-control';if(min==='select'){el.innerHTML=`<span>${label}</span><select data-sound="${key}" aria-label="${label}"><option value="triangle">Triangle</option><option value="sine">Sine</option><option value="sawtooth">Sawtooth</option><option value="square">Square</option></select>`;}else el.innerHTML=`<span>${label}</span><input type="range" data-sound="${key}" min="${min}" max="${max}" step="${step}" aria-label="${label}"><output id="${key}-detail-value" data-sound-output="${key}"></output>`;$('advanced-sound').append(el);}
document.querySelectorAll('[data-sound]').forEach(el=>el.addEventListener('input',e=>{let value=e.target.value;const key=e.target.dataset.sound;if(key!=='waveform')value=key==='cutoff'?cutoffFromX(Number(value)):Number(value);soundChange(key,value);}));
document.querySelectorAll('[data-waveform]').forEach(b=>b.addEventListener('click',()=>soundChange('waveform',b.dataset.waveform)));
const patches={warm:{...defaultSound},glass:{...defaultSound,waveform:'sine',attack:.01,decay:.6,sustain:.3,release:2.8,cutoff:6500,reverb:.4,delay:.32,detune:3},bass:{...defaultSound,waveform:'sawtooth',attack:.015,decay:.18,sustain:.4,release:.5,cutoff:560,resonance:2.4,delay:.09,reverb:.12,detune:12},pluck:{...defaultSound,waveform:'triangle',attack:.005,decay:.19,sustain:.08,release:.65,cutoff:4200,resonance:3.1,delay:.35,reverb:.3,detune:6}};
$('sound-preset').addEventListener('change',e=>{state.sound={...patches[e.target.value],volume:state.sound.volume};engine.update();syncSound();save();});

function updateStepMarker(){for(const el of $('steps').children)el.classList.toggle('current',state.playing&&Number(el.dataset.step)===state.step);$('step-readout').textContent=`STEP ${String(state.step+1).padStart(2,'0')} / ${state.sequence.length}`;}
function buildSteps(){$('steps').innerHTML='';$('steps').style.gridTemplateColumns=`repeat(${state.sequence.length},minmax(0,1fr))`;for(let i=0;i<state.sequence.length;i++){const b=document.createElement('button');b.className='step';b.dataset.step=i;b.setAttribute('aria-label',`Step ${i+1}, ${noteName(degreeToMidi(state.sequence.steps[i].note,state.sequence.root,state.sequence.scale))}`);b.setAttribute('aria-pressed',state.sequence.steps[i].active);b.innerHTML=`<span class="step-number">${String(i+1).padStart(2,'0')}</span>`;$('steps').append(b);let gesture=null;b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);gesture={y:e.clientY,moved:false,start:state.sequence.steps[i].note,velocity:state.sequence.steps[i].velocity};});b.addEventListener('pointermove',e=>{if(!gesture)return;const dy=gesture.y-e.clientY;if(Math.abs(dy)>4)gesture.moved=true;if(!gesture.moved)return;const step=state.sequence.steps[i];step.active=true;if(e.shiftKey)step.velocity=clamp(gesture.velocity+dy/100,.1,1);else step.note=Math.round(clamp(gesture.start+dy/8,0,14));b.setAttribute('aria-pressed',true);b.setAttribute('aria-label',`Step ${i+1}, ${noteName(degreeToMidi(step.note,state.sequence.root,state.sequence.scale))}`);});b.addEventListener('pointerup',()=>{if(!gesture)return;if(!gesture.moved)state.sequence.steps[i].active=!state.sequence.steps[i].active;b.setAttribute('aria-pressed',state.sequence.steps[i].active);gesture=null;save();});b.addEventListener('pointercancel',()=>{gesture=null;save();});b.addEventListener('keydown',e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const step=state.sequence.steps[i];step.note=clamp(step.note+(e.key==='ArrowUp'?1:-1),0,14);step.active=true;save();}if(e.key==='Enter'||e.key===' '){e.preventDefault();state.sequence.steps[i].active=!state.sequence.steps[i].active;b.setAttribute('aria-pressed',state.sequence.steps[i].active);save();}});}updateStepMarker();}
$('randomize-sequence').addEventListener('click',()=>{const contour=[0,2,4,7,9,7,4,2];state.sequence.steps=Array.from({length:16},(_,i)=>({note:clamp(contour[i%8]+Math.floor(Math.random()*5)-2,0,14),velocity:.45+Math.random()*.45,active:Math.random()>.13}));buildSteps();save();toast('Sequence generated');});
$('clear-sequence').addEventListener('click',()=>{state.sequence.steps.forEach(s=>s.active=false);buildSteps();save();toast('Sequence cleared');});

const ringGestures=new Map(),ringPoints=new Map(),ringStage=$('ring-stage');
let ringPinch=null;
function pinchCandidates(){return [...ringPoints].filter(([id,p])=>p.type==='touch'&&['orbit','ignored','pinch'].includes(ringGestures.get(id)));}
function beginRingPinch(){
 const points=pinchCandidates();if(points.length<2)return false;
 scene.cancelOrbit();for(const [id]of points)ringGestures.set(id,'pinch');
 const [[first,a],[second,b]]=points;ringPinch={ids:[first,second],distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:scene.orbitState().zoom};
 ringStage.style.cursor='grabbing';return true;
}
function resumeRingNavigation(){
 ringPinch=null;if(beginRingPinch())return;
 for(const [id,p]of pinchCandidates())if(scene.beginOrbit(id,p.x,p.y)){ringGestures.set(id,'orbit');break;}
}
function ringNote(e,hit=scene.pickClientPoint(e.clientX,e.clientY)){if(!hit)return null;const degree=Math.min(6,Math.floor(hit.angle*7))+Math.min(2,Math.floor(hit.radial*3))*7;return degreeToMidi(degree,state.sequence.root,state.sequence.scale);}
function ringMove(e,hit=scene.pickClientPoint(e.clientX,e.clientY)){if(!hit){scene.suspendContact(e.pointerId,e.clientX,e.clientY);return;}scene.showContact(e.pointerId,e.clientX,e.clientY,hit);const id='pointer-'+e.pointerId,note=ringNote(e,hit),old=livePointers.get(e.pointerId);if(old===note)return;livePointers.set(e.pointerId,note);engine.noteOn(id,note,.78);markNote(note,.8);}
ringStage.addEventListener('pointerdown',e=>{
 if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();ringStage.focus({preventScroll:true});
 const hit=scene.pickClientPoint(e.clientX,e.clientY,{surfaceOnly:true,tolerance:e.pointerType==='touch'||e.pointerType==='pen'?3:0});
 const mode=hit?'play':scene.beginOrbit(e.pointerId,e.clientX,e.clientY)?'orbit':'ignored';
 ringGestures.set(e.pointerId,mode);ringPoints.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});ringStage.setPointerCapture(e.pointerId);
 if(mode==='play'){if(!scene.orbitState().drag)scene.stopOrbitMomentum();ringStage.style.cursor='crosshair';ringMove(e,hit);}else if(mode==='orbit')ringStage.style.cursor='grabbing';
 if(mode!=='play'&&e.pointerType==='touch')beginRingPinch();
});
ringStage.addEventListener('pointermove',e=>{
 const mode=ringGestures.get(e.pointerId);
 if(mode)ringPoints.set(e.pointerId,{x:e.clientX,y:e.clientY,type:e.pointerType});
 if(mode==='pinch'&&ringPinch){const [a,b]=ringPinch.ids.map(id=>ringPoints.get(id));if(a&&b)scene.setZoom(ringPinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/ringPinch.distance);return;}
 if(mode==='play')ringMove(e);else if(mode==='orbit')scene.moveOrbit(e.pointerId,e.clientX,e.clientY);
 else if(!mode&&e.pointerType==='mouse')ringStage.style.cursor=scene.pickClientPoint(e.clientX,e.clientY,{surfaceOnly:true})?'crosshair':'grab';
});
function finishRingGesture(e,cancelled=false){
 const mode=ringGestures.get(e.pointerId);if(!mode)return;ringGestures.delete(e.pointerId);ringPoints.delete(e.pointerId);
 if(mode==='orbit')scene.endOrbit(e.pointerId,cancelled);
 if(mode==='play'){scene.releaseContact(e.pointerId);livePointers.delete(e.pointerId);if(cancelled||!state.hold)engine.noteOff('pointer-'+e.pointerId);}
 if(mode==='pinch'||mode==='orbit')resumeRingNavigation();
 ringStage.style.cursor=[...ringGestures.values()].some(mode=>mode==='orbit'||mode==='pinch')?'grabbing':'grab';
}
ringStage.addEventListener('pointerup',e=>finishRingGesture(e));
ringStage.addEventListener('pointercancel',e=>finishRingGesture(e,true));
ringStage.addEventListener('lostpointercapture',e=>finishRingGesture(e,true));
ringStage.addEventListener('wheel',e=>{
 if(ringGestures.size||scene.pickClientPoint(e.clientX,e.clientY,{surfaceOnly:true}))return;
 e.preventDefault();scene.stopOrbitMomentum();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?ringStage.clientHeight:1);scene.zoomBy(Math.exp(-clamp(delta,-300,300)*.0018));
},{passive:false});
ringStage.addEventListener('dblclick',e=>{if(e.sourceCapabilities?.firesTouchEvents||ringGestures.size||scene.pickClientPoint(e.clientX,e.clientY,{surfaceOnly:true}))return;e.preventDefault();scene.resetOrbit();});
ringStage.addEventListener('keydown',e=>{
 if(e.target!==ringStage)return;
 const directions={ArrowLeft:[.13,0],ArrowRight:[-.13,0],ArrowUp:[0,-.13],ArrowDown:[0,.13]};
 if(e.key==='Home'){e.preventDefault();scene.resetOrbit();}else if(['+','=','-','_'].includes(e.key)){e.preventDefault();scene.zoomBy(e.key==='-'||e.key==='_'?1/1.12:1.12);}else if(directions[e.key]){e.preventDefault();const [yaw,pitch]=directions[e.key];scene.nudgeOrbit(yaw,pitch);}
});
for(const [id,key,min,max]of [['attack-handle','attack',.005,2],['release-handle','release',.05,5]]){let active=false,startX=0,start=0;const el=$(id);el.addEventListener('pointerdown',e=>{e.preventDefault();active=true;startX=e.clientX;start=state.sound[key];el.setPointerCapture(e.pointerId);});el.addEventListener('pointermove',e=>{if(active)soundChange(key,clamp(start+(e.clientX-startX)/$('envelope-stage').clientWidth*(max-min),min,max));});for(const type of ['pointerup','pointercancel'])el.addEventListener(type,()=>active=false);el.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();soundChange(key,clamp(state.sound[key]+(e.key==='ArrowRight'?1:-1)*(max-min)/50,min,max));}});}

function closePerformance(restoreFocus=false){const panel=$('performance-popover');if(panel.hidden)return false;panel.hidden=true;$('performance-toggle').setAttribute('aria-expanded','false');if(restoreFocus)$('performance-toggle').focus({preventScroll:true});return true;}
const floatingPanels=createFloatingPanels([
 {id:'sound-popover',name:'Sound',trigger:'sound-toggle',header:'.popover-heading',focus:'#sound-preset',width:380,beforeOpen:()=>closePerformance()},
 {id:'appearance',name:'Appearance',trigger:'appearance-toggle',header:'.ae-top',focus:'.ae-look',width:420,beforeOpen:()=>{closePerformance();appearance.refresh();}},
]);
$('sound-toggle').addEventListener('click',()=>floatingPanels.toggle('sound-popover'));
$('appearance-toggle').addEventListener('click',()=>floatingPanels.toggle('appearance'));
$('performance-toggle').addEventListener('click',()=>{if(closePerformance(true))return;$('performance-popover').hidden=false;$('performance-toggle').setAttribute('aria-expanded','true');$('root').focus({preventScroll:true});});
document.addEventListener('click',e=>{const close=e.target.closest('[data-close]');if(!close)return;const id=close.dataset.close;if(id==='performance-popover')closePerformance(true);else floatingPanels.close(id,true);});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#performance-popover,#performance-toggle'))closePerformance();});
const disableSecondaryButtonTaps=enableSecondaryButtonTaps();
function syncKey(){const root=$('root').selectedOptions[0]?.textContent||'D',scale=$('scale').selectedOptions[0]?.textContent||'Dorian';$('key-readout').textContent=root+' · '+scale;$('key-compact').textContent=root;$('performance-toggle').setAttribute('aria-label',root+' '+scale+'. Key and arpeggiator settings');}
const musicalKeys=['a','s','d','f','g','h','j','k'];
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!closePerformance(true)&&!floatingPanels.closeActive(true))panic();return;}if(e.target.closest('input,select,textarea,[contenteditable]')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==='Space'){if(e.target.closest('button,summary'))return;e.preventDefault();if(!e.repeat)togglePlay();return;}const index=musicalKeys.indexOf(e.key.toLowerCase());if(index>=0&&!e.repeat){e.preventDefault();keys.add(e.key.toLowerCase());const note=degreeToMidi(index,state.sequence.root,state.sequence.scale);engine.noteOn('key-'+e.key.toLowerCase(),note,.7);markNote(note);}});
document.addEventListener('keyup',e=>{const key=e.key.toLowerCase();if(keys.delete(key)&&!state.hold)engine.noteOff('key-'+key);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)panic();});window.addEventListener('blur',panic);window.addEventListener('pagehide',()=>{panic();try{localStorage.setItem(STORAGE,JSON.stringify(state));}catch{}});
function syncAll(){for(const[id,key]of [['bpm','bpm'],['root','root'],['scale','scale'],['sequence-length','length'],['swing','swing'],['arp-rate','arpRate'],['arp-direction','arpDirection']]){$(id).value=state.sequence[key];if($(id).type==='range')updateRange($(id));}$('swing-value').textContent=Math.round(state.sequence.swing*100)+'%';syncSound();syncKey();applyVisual();appearance.refresh();buildSteps();updateTransport();tempoControl.sync();engine.update();}
syncAll();save();

function hexAlpha(hex,a){if(!/^#[0-9a-f]{6}$/i.test(hex))return`rgba(217,163,108,${a})`;return`rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;}
function fit(canvas){const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(r.width*d)||canvas.height!==Math.round(r.height*d)){canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);}const c=canvas.getContext('2d');c.setTransform(d,0,0,d,0,0);return[c,r.width,r.height];}
function line(c,x1,y1,x2,y2,color,width=1){c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();}
function drawSequence(){const[c,w,h]=fit($('sequence-canvas'));if(!w||!h)return;const p=palette();c.clearRect(0,0,w,h);for(let i=0;i<4;i++)line(c,0,8+(h-16)*i/3,w,8+(h-16)*i/3,hexAlpha(p.reference?p.fg:p.accent,p.reference?.5:.12),p.reference?.8:.5);const steps=state.sequence.steps.slice(0,state.sequence.length),points=steps.map((s,i)=>({x:(i+.5)*w/steps.length,y:h-10-(s.note/14)*(h-20),s}));if(p.reference){c.strokeStyle=hexAlpha(p.fg,.46);c.lineWidth=1.2;c.beginPath();points.forEach((pt,i)=>{const vy=h-7-pt.s.velocity*(h-14);if(i)c.lineTo(pt.x,vy);else c.moveTo(pt.x,vy);});c.stroke();}c.lineWidth=p.reference?2:1;c.strokeStyle=hexAlpha(p.accent,p.reference?.95:.55);c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.stroke();for(let i=0;i<points.length;i++){const pnt=points[i],active=pnt.s.active,selected=state.playing&&i===state.step;c.shadowColor=p.accent;c.shadowBlur=selected?16:active?(p.reference?6:4):0;c.fillStyle=active?(selected?p.fg:p.accent):p.bg;c.strokeStyle=active?p.fg:hexAlpha(p.fg,.45);c.lineWidth=p.reference?1.2:.8;c.beginPath();c.arc(pnt.x,pnt.y,active?(p.reference?(selected?7.5:4.5):3.5)+pnt.s.velocity*1.3:3,0,TAU);c.fill();c.stroke();c.shadowBlur=0;const label=$('steps').children[i]?.querySelector('.step-number');if(label){const content=p.reference?String(degreeToMidi(pnt.s.note,state.sequence.root,state.sequence.scale)):String(i+1).padStart(2,'0');if(label.textContent!==content)label.textContent=content;}}}
function drawEnvelope(){const[c,w,h]=fit($('envelope-canvas'));if(!w||!h)return;const p=palette(),ax=10+state.sound.attack/2*w*.3,rx=w*.6+state.sound.release/5*w*.34,sy=8+(1-state.sound.sustain)*(h-14),dy=w*.3;c.clearRect(0,0,w,h);line(c,0,h-3,w,h-3,hexAlpha(p.reference?p.fg:p.accent,.25),.5);
 const drawPath=(offset=0)=>{c.beginPath();c.moveTo(0,h-3);c.quadraticCurveTo(ax*.75,h-2,ax,5+offset);c.bezierCurveTo(ax+12,5+offset,dy-8,sy+offset,dy,sy+offset);c.lineTo(w*.58,sy+offset);c.bezierCurveTo(w*.67,sy+offset,rx-12,h-3,rx,h-3);c.lineTo(w,h-3);};
 drawPath();c.strokeStyle=hexAlpha(p.reference?p.fg:p.accent,p.reference?1:.85);c.lineWidth=p.reference?2:1.1;c.stroke();
 if(p.reference){const voices=activity().voices||[],energy=Math.max(0,...voices.map(v=>v.envelope));c.setLineDash([3,3]);drawPath(3+(1-energy)*6);c.strokeStyle=hexAlpha(p.accent,.85);c.lineWidth=1.1;c.stroke();c.setLineDash([]);if(h>34){c.font='bold '+(w>420?11:9)+'px '+UI_FONT;c.fillStyle=p.fg;c.fillText(formatSound('attack',state.sound.attack),Math.max(20,ax+13),18);if(w>270){c.fillText(formatSound('decay',state.sound.decay),dy-13,Math.min(h-10,sy+17));c.fillText(formatSound('sustain',state.sound.sustain),w*.49,sy-8);c.fillText(formatSound('release',state.sound.release),Math.min(rx+12,w-50),h-12);}c.fillStyle=p.accent;c.fillText('ENV '+energy.toFixed(2),w*.4,h-3);}if(energy>.01){const x=w*.58,y=sy;c.shadowColor=p.accent;c.shadowBlur=12;c.fillStyle=p.accent;c.beginPath();c.arc(x,y,3+energy*2,0,TAU);c.fill();c.shadowBlur=0;}}
 else{c.lineTo(0,h);c.closePath();const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,hexAlpha(p.accent,.2));g.addColorStop(1,hexAlpha(p.accent,0));c.fillStyle=g;c.fill();}
 $('attack-handle').style.left=ax+'px';$('attack-handle').style.top='5px';$('release-handle').style.left=rx+'px';$('release-handle').style.top=(h-3)+'px';}
let lastDraw=0;function animate(now){requestAnimationFrame(animate);if(document.hidden||now-lastDraw<30)return;lastDraw=now;notePulse*=.9;drawSequence();drawEnvelope();updateStepMarker();const a=activity();const n=(a.voices||[]).filter(v=>v.envelope>.01).length;$('voice-count').textContent='VOICES '+String(n).padStart(2,'0')+' / 08';}requestAnimationFrame(animate);
window.addEventListener('beforeunload',()=>{disableSecondaryButtonTaps();signalRanges();tempoControl.destroy();anchorObserver.disconnect();scene.setParticleLayerProvider(null);signalField.dispose();galaxy.dispose();scene.dispose();engine.dispose();pwa.destroy();});
