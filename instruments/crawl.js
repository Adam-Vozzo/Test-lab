import {clamp,createSurface,bindPointers} from './kit.js';
import {signalRenderProfile,renderPixelRatio,createFrameGate} from '../render-performance.js';
import {CrawlWorld} from './crawl-world.js';
import {CrawlRenderer} from './crawl-renderer.js';
import {CrawlAudioResponse} from './crawl-audio.js';

const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
 id:'crawl',name:'Crawl',layoutMode:'single',commonSoundControls:false,keyboardNotes:false,performance:{arp:false,hold:false},
 theme:{bg:'#080b0c',fg:'#b4b8af',accent:'#d6ef62',muted:'#727c80'},
 defaultSound:{waveform:'triangle',attack:.014,decay:.3,sustain:.5,release:.7,cutoff:8500,resonance:.8,gain:.68,pan:0,ratio:1,index:0,detune:0,glide:.05,echo:.18,delayTime:.27,feedback:.22,speed:.65,activity:.6,curiosity:.65,population:5,motionEnergy:.65},
 defaultAppearance:{panelColour:'#080b0c',traceColour:'#56626b',legendColour:'#bfc7bf',creatureLime:'#d6ef62',creatureViolet:'#7273c8',creatureCoral:'#ef8466',creatureTeal:'#6dd7b4',circuitContrast:.5,panelContrast:.65,controlContrast:.95,legendContrast:.9,legWeight:1,jointSize:1,creatureGlow:.3,limbEnvelope:.2,chroma:.7,colourFlow:.35,anatomyDetail:.75,audioMotion:.65,audioColour:.8,audioGlow:.45,audioSensitivity:1.2,scopeGain:.8,sceneGrain:.025,sceneGrainSize:1},
 soundControls:[
  range('population','Creature count',1,5,1,'Behaviour','Adds a centipede, spider, beetle, mantis and scorpion, in that order. Every creature can operate all four sound circuits.'),
  range('speed','Walking speed',.15,1,.05,'Behaviour','Speed of travel between controls. Limbs still plant and lift independently.'),
  range('motionEnergy','Movement variation',0,1,.05,'Behaviour','Strength of each species’ bursts, turns and secondary body movements. Zero keeps a steadier walking pace.'),
  range('activity','Control activity',0,1,.05,'Behaviour','How frequently creatures choose and operate a nearby dial, fader or switch.'),
  range('curiosity','Wander range',0,1,.05,'Behaviour','How readily creatures leave their current area to explore other sound circuits.'),
  range('echo','Delay level',0,.4,.01,'Output','Amount of the circuit voices sent to the shared stereo delay.'),
  range('delayTime','Delay time',.08,.8,.01,'Output','Time between repetitions of the circuit voices.','s'),
  range('feedback','Delay feedback',0,.5,.01,'Output','Amount fed back through the delay; higher values leave longer traces of previous settings.')
 ],
 appearanceControls:[
  {key:'panelColour',label:'Panel background',kind:'color',section:'Panel',description:'Background colour behind the four sound circuits.'},
  {key:'traceColour',label:'Circuit colour',kind:'color',section:'Panel',description:'Colour of the fine traces, panel boundaries and internal guides.'},
  range('circuitContrast','Circuit trace contrast',0,1,.05,'Panel','Brightness of the fine wires connecting the controls.'),
  range('panelContrast','Panel boundary contrast',0,1,.05,'Panel','Brightness of the boundaries and dividers around each circuit.'),
  range('controlContrast','Control contrast',.2,1,.05,'Controls','Brightness of dial scales, slider tracks, switch contacts and their active states.'),
  {key:'legendColour',label:'Legend colour',kind:'color',section:'Controls',description:'Colour of the technical labels and parameter readouts.'},
  range('legendContrast','Legend contrast',.15,1,.05,'Controls','Brightness of the control labels, values and circuit annotations.'),
  {key:'creatureLime',label:'Lime accent',kind:'color',section:'Creatures',description:'Base lime colour in the creatures’ palette, first sound circuit and guide markers.'},
  {key:'creatureViolet',label:'Violet accent',kind:'color',section:'Creatures',description:'Base violet colour in the creatures’ palette and second sound circuit.'},
  {key:'creatureCoral',label:'Coral accent',kind:'color',section:'Creatures',description:'Base coral colour in the creatures’ palette, third sound circuit and upper output-meter segments.'},
  {key:'creatureTeal',label:'Teal accent',kind:'color',section:'Creatures',description:'Base teal colour in the creatures’ palette and fourth sound circuit.'},
  range('chroma','Colour variation',0,1,.05,'Creatures','Amount of spectral colour variation along shells, body segments and legs. Zero uses each creature’s base palette before sound-driven colour is applied.'),
  range('colourFlow','Colour motion',0,1,.05,'Creatures','Speed of slow colour movement across the creatures. Zero stops ambient colour movement; sound-driven colour remains independent.'),
  range('anatomyDetail','Anatomy detail',0,1,.05,'Creatures','Visibility of shell facets, wing veins and fine body construction lines. Main silhouettes and legs remain visible.'),
  range('legWeight','Leg stroke weight',.5,1.8,.05,'Creatures','Width of the articulated leg strokes. Does not change reach or walking geometry.','×'),
  range('jointSize','Joint marker size',.5,1.8,.05,'Creatures','Size of the small markers at knees, feet and body joints.','×'),
  range('limbEnvelope','Limb construction lines',0,1,.05,'Creatures','Opacity of the faint outer wire cages around articulated legs.'),
  range('creatureGlow','Creature light spill',0,1,.05,'Creatures','Soft light around the creature wires, leaving their centre strokes sharp.'),
  range('audioMotion','Sound-driven movement',0,1,.05,'Audio response','Measured audio compresses centipede segments, flexes the spider abdomen, opens beetle wing covers, bends the mantis thorax and lifts scorpion armour. Feet and operating hands stay anchored.'),
  range('audioColour','Sound-driven colour',0,1,.05,'Audio response','Strength of spectral colour shifts along each anatomy: ganglia, radial abdomen facets, wing veins, thorax serrations and armour seams. Independent of ambient colour motion.'),
  range('audioGlow','Sound-driven light',0,1,.05,'Audio response','Extra wire and joint brightness on sounding notes. Does not brighten the panel or alter audio volume.'),
  range('audioSensitivity','Response sensitivity',.25,3,.05,'Audio response','Visual sensitivity to the measured output level. Higher values make quieter notes more visible.','×'),
  range('scopeGain','Scope amplitude',.3,2,.05,'Meter','Vertical scale of the measured output waveform in the central strip. Does not alter audio gain.','×')
 ]
};

const value=(controls,lane,key,fallback=.5)=>clamp(controls.find(control=>control.lane===lane&&control.key===key)?.value??fallback);
const divisions=[1,2,3,4,6,8];

/** The visible panel is the only source of the four circuit patches. */
export function crawlVoice(lane,controls,sound,quantize){
 lane=Math.max(0,Math.min(3,Math.round(lane)));
 const read=key=>value(controls,lane,key),pitch=read('pitch'),register=read('range'),shape=read('shape'),tone=read('tone'),resonance=read('resonance'),decay=read('decay'),detune=read('detune'),accent=read('accent');
 const degree=Math.round(pitch*7),octave=(lane===0||lane===3?-1:0)+(register>=.5?1:0),midi=quantize(degree,octave);
 const common={gain:clamp(sound.gain??.68,0,1),velocity:.38+accent*.45,pan:[-.30,.28,-.12,.18][lane],glide:.04,detune:(detune-.5)*18,resonance:.45+resonance*2.8,crush:0};
 let options;
 if(lane===0){
  // A rounded fundamental with a small harmonic edge; the low circuit never
  // becomes a brittle saw or a high-index FM oscillator.
  options={...common,waveform:shape<.34?'sine':shape<.74?'triangle':'wavetable',tablePosition:.08+shape*.2,tableWarp:shape*.10,index:shape*.12,ratio:2,attack:.018,decay:.18+decay*.25,sustain:.64,release:.20+decay*.8,cutoff:180*Math.pow(20,tone),gain:common.gain*.92};
 }else if(lane===1){
  options={...common,waveform:'sine',ratio:[1,1.5,2,3][Math.min(3,Math.floor(shape*4))],index:.22+shape*2.4,attack:.008,decay:.16+decay*.7,sustain:.10,release:.38+decay*1.65,cutoff:900*Math.pow(9,tone),gain:common.gain*.60};
 }else if(lane===2){
  options={...common,waveform:'wavetable',tablePosition:.14+shape*.54,tableWarp:.06+shape*.27,index:0,ratio:1,attack:.007,decay:.10+decay*.40,sustain:.16,release:.16+decay*.9,cutoff:700*Math.pow(10,tone),gain:common.gain*.57};
 }else{
  options={...common,waveform:'receiver',sideband:.15+shape*.48,spread:.10+detune*.25,air:.025+shape*.055,drift:.12+detune*.15,bandwidth:.25+tone*.65,index:0,ratio:1,attack:.10+decay*.16,decay:.30+decay*.45,sustain:.5,release:.70+decay*1.8,cutoff:550*Math.pow(11,tone),gain:common.gain*.5};
 }
 return{midi,options,division:divisions[Math.min(divisions.length-1,Math.floor(read('division')*divisions.length))],gate:.18+read('gate')*.76};
}

export function mount(host,api){
 const shell=document.createElement('div');shell.className='crawl-instrument';shell.style.cssText='position:relative;width:100%;height:100%;min-height:0;';host.append(shell);
 const style=document.createElement('style');style.textContent=`.crawl-mode{position:absolute;top:6px;right:12px;display:flex;gap:3px;z-index:2;font:10px "SFMono-Regular",Consolas,monospace}.crawl-mode button{min-width:64px;min-height:44px;padding:0 10px;border:1px solid transparent;border-radius:2px;background:transparent;color:var(--muted);font:inherit;letter-spacing:.08em;text-transform:uppercase;touch-action:manipulation;-webkit-user-select:none;user-select:none}.crawl-mode button[aria-pressed=true]{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 35%,transparent);background:color-mix(in srgb,var(--accent) 6%,transparent)}.crawl-mode button:focus-visible{outline:1px solid var(--accent);outline-offset:2px}@media(max-width:500px){.crawl-mode{right:6px;gap:0}.crawl-mode button{min-width:58px;padding:0 7px}}`;shell.append(style);
 const surface=createSurface(shell,{label:'Crawl. Creatures operate the sound controls. Touch or drag anywhere to guide the nearest creature; the controls cannot be changed directly. Wander releases a creature when you lift. Guide leaves its destination in place. Use the arrow keys to guide a creature, W for Wander, G for Guide, or Escape to release guidance.'}),c=surface.ctx,world=new CrawlWorld(4187),renderer=new CrawlRenderer(),profile=signalRenderProfile(),gate=createFrameGate(profile.mobile?60:90);
 surface.resize=()=>{const r=surface.canvas.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height),d=renderPixelRatio(w,h,window.devicePixelRatio||1,{maxDpr:1.5,maxPixels:profile.mobile?1000000:1700000});if(surface.canvas.width!==Math.round(w*d)||surface.canvas.height!==Math.round(h*d)||surface.dpr!==d){surface.canvas.width=Math.max(1,Math.round(w*d));surface.canvas.height=Math.max(1,Math.round(h*d));c.setTransform(d,0,0,d,0,0);}Object.assign(surface,{width:w,height:h,dpr:d});if(world.panel.w!==w||world.panel.h!==h)world.resize(w,h);return surface;};surface.resize();
 const toolbar=document.createElement('div');toolbar.className='crawl-mode';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Creature guidance');
 for(const [mode,label,description]of [['wander','Wander','Creatures wander freely after you release them.'],['guide','Guide','Leave a destination for a creature after you release it.']]){const button=document.createElement('button');button.type='button';button.dataset.mode=mode;button.textContent=label;button.title=description;button.setAttribute('aria-pressed',String(mode==='wander'));toolbar.append(button);}shell.append(toolbar);
 const contacts=new Map(),keyboard=new Set();let mode='wander',selected=null,lastTime=0,destroyed=false,playing=false,sequenceTick=0,lastArrival=-1,lastStatus='',keyboardPoint={x:.5,y:.5};
 const appearance=()=>({...definition.defaultAppearance,...api.state.appearance}),audioResponse=new CrawlAudioResponse();
 const patch=lane=>crawlVoice(lane,world.panel.controls,api.state.sound,api.quantize);
 const sourceId=pointer=>'crawl-touch-'+pointer;
 const creatureLane=id=>Math.abs(Number(String(id).match(/\d+$/)?.[0])||0)%4;
 function syncMode(){for(const button of toolbar.children)button.setAttribute('aria-pressed',String(button.dataset.mode===mode));}
 function setMode(next){if(next!=='wander'&&next!=='guide')return;mode=next;if(mode==='wander')for(const [pointer,guide]of world.guides)if(guide.persistent)world.releaseGuide(pointer,false);syncMode();api.save();}
 function audition(q,first=false){const voice=patch(q.lane),restart=first||voice.options.waveform!==q.waveform;q.waveform=voice.options.waveform;(restart?api.noteOn:api.noteUpdate)(q.source,voice.midi,voice.options);}
 function begin(pointer,x,y){
  surface.resize();const creatureId=world.setGuide(pointer,x,y);if(creatureId===null||creatureId===undefined)return false;
  const q={pointer,x,y,creatureId,lane:creatureLane(creatureId),source:sourceId(pointer),waveform:null};contacts.set(pointer,q);selected=creatureId;audition(q,true);return true;
 }
 function move(pointer,x,y){const q=contacts.get(pointer);if(!q)return;q.x=x;q.y=y;world.setGuide(pointer,x,y);}
 function end(pointer,cancelled=false){const q=contacts.get(pointer);if(!q)return;(cancelled?(api.noteCancel||api.noteOff):api.noteOff)(q.source);contacts.delete(pointer);world.releaseGuide(pointer,!cancelled&&mode==='guide');selected=[...contacts.values()].at(-1)?.creatureId??null;api.save();}
 const unbind=bindPointers(surface.canvas,{down:p=>begin(p.id,p.x,p.y),move:p=>move(p.id,p.x,p.y),up:p=>end(p.id),cancel:p=>end(p.id,true)});
 const onMode=e=>{const button=e.target.closest('[data-mode]');if(button)setMode(button.dataset.mode);};toolbar.addEventListener('click',onMode);
 function releaseAll(){for(const q of contacts.values())(api.noteCancel||api.noteOff)(q.source);contacts.clear();keyboard.clear();world.clearGuides();selected=null;}
 const onKeyDown=e=>{
  if(e.altKey||e.ctrlKey||e.metaKey)return;
  if(e.key==='Escape'){e.preventDefault();releaseAll();api.save();return;}
  if(e.key.toLowerCase()==='w'||e.key.toLowerCase()==='g'){e.preventDefault();setMode(e.key.toLowerCase()==='w'?'wander':'guide');return;}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();keyboard.add(e.key);
  keyboardPoint.x=clamp(keyboardPoint.x+(e.key==='ArrowRight'?.035:e.key==='ArrowLeft'?-.035:0),.04,.96);keyboardPoint.y=clamp(keyboardPoint.y+(e.key==='ArrowDown'?.045:e.key==='ArrowUp'?-.045:0),.10,.92);
  const x=keyboardPoint.x*surface.width,y=keyboardPoint.y*surface.height;if(!contacts.has('keyboard')){api.audio.start();begin('keyboard',x,y);}else move('keyboard',x,y);
 };
 const onKeyUp=e=>{if(!keyboard.has(e.key))return;e.preventDefault();keyboard.delete(e.key);if(!keyboard.size)end('keyboard');},onBlur=()=>{if(contacts.has('keyboard')){keyboard.clear();end('keyboard',true);}};surface.canvas.addEventListener('keydown',onKeyDown);surface.canvas.addEventListener('keyup',onKeyUp);surface.canvas.addEventListener('blur',onBlur);
 function applyActions(actions){
  if(!actions.length)return;
  for(const action of actions){
   for(const q of contacts.values()){
    if(action.lane>=0&&q.creatureId===action.creatureId)q.lane=action.lane;
    if(action.lane===q.lane)audition(q);
   }
   // The new setting is heard on contact, even between clocked notes. Its
   // short articulation shares the same patch as the next sequence event.
   if(playing&&action.lane>=0){const voice=patch(action.lane);api.audio.pulse('crawl-contact-'+action.creatureId,voice.midi,{...voice.options,velocity:voice.options.velocity*.65},api.audio.now,.07+voice.gate*.12);}
  }
  api.save();
 }
 return{
  frame(t,dt){if(destroyed||!gate.due(t*1000))return;dt=Math.min(.05,lastTime?t-lastTime:dt);lastTime=t;surface.resize();const sound=api.state.sound;
   const look=appearance(),snapshot=api.audio.snapshot();audioResponse.update(snapshot,dt,{sampleRate:api.audio.context?.sampleRate||48000,sensitivity:look.audioSensitivity});audioResponse.assign(world.creatures);
   const actions=world.update(dt,{speed:sound.speed,activity:sound.activity,curiosity:sound.curiosity,population:sound.population,motionEnergy:sound.motionEnergy,audioMotion:look.audioMotion,mode,reducedMotion:api.reducedMotion});applyActions(actions);
   // Population edits may remove a guided creature; its owned source must not
   // outlive the visible body, even while a finger remains on the canvas.
   const living=new Set(world.creatures.map(creature=>creature.id));for(const q of [...contacts.values()])if(!living.has(q.creatureId))end(q.pointer,true);
   const patches=[0,1,2,3].map(patch),notes=patches.map(voice=>api.noteName(voice.midi));c.clearRect(0,0,surface.width,surface.height);renderer.draw(c,world,look,snapshot,{time:world.time,mode,selected,playing,step:snapshot.step,notes,patches,reducedMotion:api.reducedMotion});
   const status=`${world.creatures.length} AGENTS · ${mode==='guide'?'GUIDE':'WANDER'}`;if(status!==lastStatus){api.setStatus(status);lastStatus=status;}
  },
  onStep(step,when){if(!playing)return;const tick=sequenceTick++,controls=world.panel.controls,contact=controls.find(control=>control.key==='step'&&control.index===step%16);if(contact&&contact.value<.5)return;const cycle=Math.floor(tick/16),arrival=lastArrival!==cycle;lastArrival=cycle;
   for(let lane=0;lane<4;lane++){const voice=patch(lane);if(!arrival&&tick%voice.division)continue;const interval=60/api.state.bpm/4*voice.division,duration=Math.max(.035,interval*voice.gate),accent=step%4===0?1:.82;api.audio.pulse('crawl-sequence-'+lane,voice.midi,{...voice.options,velocity:voice.options.velocity*accent},when,duration);}
  },
  setPlaying(value){value=Boolean(value);if(value&&!playing){sequenceTick=0;lastArrival=-1;}if(!value&&playing)releaseAll();playing=value;},
  update(key,kind){if(kind==='performance')for(const q of contacts.values())audition(q);},
  cancel(){releaseAll();audioResponse.reset();audioResponse.assign(world.creatures);},
  getData(){return{...world.getData(),mode};},
  setData(data){releaseAll();audioResponse.reset();world.setData(data);audioResponse.assign(world.creatures);if(data?.mode==='wander'||data?.mode==='guide')mode=data.mode;syncMode();},
  destroy(){if(destroyed)return;destroyed=true;unbind();releaseAll();toolbar.removeEventListener('click',onMode);surface.canvas.removeEventListener('keydown',onKeyDown);surface.canvas.removeEventListener('keyup',onKeyUp);surface.canvas.removeEventListener('blur',onBlur);renderer.dispose();surface.destroy();shell.remove();}
 };
}
