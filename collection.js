import {INSTRUMENTS} from './instruments/catalog.js';
import {APPEARANCE_REVISION,SOUND_REVISION,migrateAppearance,migrateSound} from './instruments/appearance-migration.js';
import {clamp,noteName} from './instruments/kit.js';
import {CollectionAudio} from './collection-audio.js';
import {createFloatingPanels} from './floating-panels.js';
import {createTempoControl} from './tempo-control.js';
import {enableSecondaryButtonTaps} from './touch-controls.js';
import {setupPWA} from './pwa.js';

const $=id=>document.getElementById(id),stage=$('stage');
const SCALES={dorian:[0,2,3,5,7,9,10],minor:[0,2,3,5,7,8,10],major:[0,2,4,5,7,9,11],pentatonic:[0,3,5,7,10],chromatic:Array.from({length:12},(_,i)=>i)};
const BASE_SOUND={waveform:'triangle',attack:.025,decay:.25,sustain:.65,release:.7,cutoff:6500,resonance:1,detune:0,ratio:1,index:0,gain:.24,pan:0,glide:.025};
const COMMON_SOUND=[
  {key:'waveform',label:'Oscillator',kind:'select',options:[['sine','Sine'],['triangle','Triangle'],['sawtooth','Saw'],['square','Pulse']],section:'Voice',description:'Oscillator waveform feeding the voice.'},
  {key:'cutoff',label:'Filter cutoff',min:80,max:16000,step:10,unit:'Hz',section:'Voice',description:'Upper frequency range of each voice.'},
  {key:'resonance',label:'Resonance',min:.1,max:10,step:.1,unit:'Q',section:'Voice',description:'Emphasis around the filter cutoff.'},
  {key:'detune',label:'Detune',min:-40,max:40,step:1,unit:'ct',section:'Voice',description:'Fine oscillator tuning in cents.'},
  {key:'attack',label:'Attack',min:.005,max:2,step:.005,unit:'s',section:'Envelope',description:'Time to reach full amplitude.'},
  {key:'decay',label:'Decay',min:.02,max:2,step:.01,unit:'s',section:'Envelope',description:'Time to reach the sustained level.'},
  {key:'sustain',label:'Sustain',min:0,max:1,step:.01,section:'Envelope',description:'Amplitude while a note is held.'},
  {key:'release',label:'Release',min:.03,max:5,step:.01,unit:'s',section:'Envelope',description:'Time for a released note to fade.'},
];
let definition=null,controller=null,currentId='',loadToken=0,playRequest=0,raf=0,lastTime=0,lastSync=0;
let state={bpm:112,root:50,scale:'dorian',playing:false,hold:false,arp:false,arpRate:8,sound:{...BASE_SOUND},appearance:{}};
let controls={sound:[],appearance:[]},groups={sound:'',appearance:''},looks=[],undo=[],changeBefore=null,saveTimer=0,toastTimer=0;
const pointers=new Set(),keys=new Set(),audio=new CollectionAudio({onStateChange:()=>{
  const active=state.playing||state.hold||pointers.size>0||keys.size>0;
  panic();
  if(active&&!document.hidden)toast('Audio interrupted. Tap Play to resume.');
}});
const safeRead=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
const storageKey=()=>`duo.instrument.${currentId}.v1`;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=(c,v)=>{if(c.kind==='toggle')return v?'On':'Off';if(c.kind==='select'||c.kind==='color')return '';if(!Number.isFinite(v))return '';let n;if(c.unit==='Hz'&&v>=1000)n=(v/1000).toFixed(v<10000?2:1)+'k';else if(c.step>=1)n=String(Math.round(v));else n=v.toFixed(c.step>=.1?1:c.step>=.01?2:3).replace(/\.?0+$/,'');return `${n}${c.unit?' '+c.unit:''}`;};

function sanitize(defaults,descriptors,raw){
  const out={...defaults};if(!raw||typeof raw!=='object'||Array.isArray(raw))return out;
  const map=new Map(descriptors.map(c=>[c.key,c]));
  for(const [key,value]of Object.entries(defaults)){
    const input=raw[key],c=map.get(key);
    if(c?.kind==='select'){if(c.options.some(([v])=>v===input))out[key]=input;}
    else if(c?.kind==='color'||(typeof value==='string'&&value.startsWith('#'))){if(/^#[0-9a-f]{6}$/i.test(input||''))out[key]=input;}
    else if(typeof value==='boolean'){if(typeof input==='boolean')out[key]=input;}
    else if(typeof value==='number'&&Number.isFinite(input))out[key]=clamp(input,c?.min??-100000,c?.max??100000);
    else if(typeof value==='string'&&typeof input==='string'&&input.length<100)out[key]=input;
  }
  return out;
}
function persisted(){return{schema:1,instrument:currentId,appearanceRevision:APPEARANCE_REVISION,soundRevision:SOUND_REVISION,bpm:state.bpm,root:state.root,scale:state.scale,arp:state.arp,arpRate:state.arpRate,sound:state.sound,appearance:state.appearance,data:controller?.getData?.()};}
function saveNow(){clearTimeout(saveTimer);if(!definition)return;try{localStorage.setItem(storageKey(),JSON.stringify(persisted()));}catch{toast('Settings could not be saved on this device');}}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,180);}
function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2600);}
function quantize(degree,octave=0){const scale=SCALES[state.scale]||SCALES.dorian,d=Math.round(degree),n=((d%scale.length)+scale.length)%scale.length;return clamp(state.root+scale[n]+12*(Math.floor(d/scale.length)+octave),21,108);}
function setStatus(text){if($('instrument-status').textContent!==text)$('instrument-status').textContent=text;}
function unlockFromGesture(reportFailure=false){
  const token=loadToken;
  // Keep the resume call in the native input dispatch. Safari may accept the
  // ending touch even when its preceding pointerdown could not unlock audio.
  const request=audio.start();
  Promise.resolve(request).then(ready=>{if(ready===false&&reportFailure&&token===loadToken)toast('Audio could not start. Tap Play to retry.');}).catch(()=>{if(reportFailure&&token===loadToken)toast('Audio could not start. Tap Play to retry.');});
}
function setSound(patch){const resolved=sanitize({...state.sound},controls.sound,{...state.sound,...patch});Object.assign(state.sound,resolved);audio.configure(Object.fromEntries(Object.keys(patch).filter(key=>Object.hasOwn(resolved,key)).map(key=>[key,resolved[key]])));syncControls('sound');save();}
function performanceState(){audio.setPerformance({hold:state.hold,arp:state.arp,bpm:state.bpm,arpRate:state.arpRate});}
function syncTransport(){
  $('play').classList.toggle('playing',state.playing);$('play').setAttribute('aria-label',state.playing?'Pause sequence':'Play sequence');$('play').innerHTML=state.playing?'<svg viewBox="0 0 20 20"><path d="M6 4h3v12H6zM12 4h3v12h-3z"/></svg>':'<svg viewBox="0 0 20 20"><path d="m7 4 10 6-10 6Z"/></svg>';
  $('arp').setAttribute('aria-pressed',String(state.arp));$('hold').setAttribute('aria-pressed',String(state.hold));
  $('key-readout').textContent=`${noteName(state.root).replace(/-?\d+$/,'')} · ${state.scale[0].toUpperCase()+state.scale.slice(1)}`;
  $('bpm').value=state.bpm;$('root').value=state.root;$('scale').value=state.scale;$('arp-rate').value=state.arpRate;tempo.sync();
  window.dispatchEvent(new Event('duo:transport'));
}
function transport(){audio.setTransport({playing:state.playing,bpm:state.bpm,onStep:(step,when)=>controller?.onStep?.(step,when)});}
async function togglePlay(){if(!controller)return;const token=++playRequest;if(state.playing){state.playing=false;transport();syncTransport();return;}state.playing=true;syncTransport();const ready=await audio.start();if(token!==playRequest)return;if(ready===false){state.playing=false;syncTransport();toast('Audio could not start. Tap Play to retry.');return;}transport();syncTransport();}
function panic(){++playRequest;controller?.cancel?.();state.playing=false;state.hold=false;keys.clear();pointers.clear();audio.panic();performanceState();transport();syncTransport();}
function closeDisclosure(id,focus=false){$(id).hidden=true;const trigger=id==='collection-menu'?$('collection-toggle'):$('performance-toggle');trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus({preventScroll:true});}

function applyTheme(){const theme=definition.theme;for(const key of ['bg','fg','accent','muted'])document.documentElement.style.setProperty('--'+key,theme[key]);const n=parseInt(theme.bg.replace('#',''),16),l=((n>>16)*.2126+(n>>8&255)*.7152+(n&255)*.0722);document.documentElement.style.colorScheme=l>150?'light':'dark';document.querySelector('meta[name=theme-color]').content=theme.bg;}
function refreshLibrary(){
  let batch=-1;$('collection-list').innerHTML=INSTRUMENTS.map((item,i)=>{let group='';if(item.batch!==batch){batch=item.batch;group=`<div class="collection-group">${batch===0?'SIGNAL':`BATCH ${String(batch).padStart(2,'0')}`}</div>`;}const href=item.href||`#${item.id}`;return group+`<a class="collection-entry" href="${href}" data-instrument="${item.id}" aria-current="${item.id===currentId}" style="--a:${item.colors[0]};--b:${item.colors[1]}"><i class="swatch" aria-hidden="true"></i><span><b>${escape(item.name)}</b><small>${escape(item.description)}</small></span><em>${String(i+1).padStart(2,'0')}</em></a>`;}).join('');
}

function buildTabs(kind){
  const sections=[...new Set(controls[kind].map(c=>c.section||'Parameters'))];if(!sections.includes(groups[kind]))groups[kind]=sections[0]||'';
  const tabs=document.querySelector(`[data-tabs=${kind}]`);tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',`${kind} categories`);
  tabs.innerHTML=sections.map(name=>`<button role="tab" type="button" data-group="${escape(name)}" tabindex="${name===groups[kind]?0:-1}" aria-selected="${name===groups[kind]}">${escape(name)}</button>`).join('');
  renderControls(kind);
}
function renderControls(kind){
  const body=document.querySelector(`[data-controls=${kind}]`);body.innerHTML=controls[kind].filter(c=>(c.section||'Parameters')===groups[kind]).map(c=>{
    const id=`${kind}-${c.key}`,v=state[kind][c.key],description=`<small id="${id}-help">${escape(c.description||'')}</small>`,attr=`data-kind="${kind}" data-key="${c.key}" id="${id}" aria-describedby="${id}-help"`;
    let input;if(c.kind==='select')input=`<select ${attr}>${c.options.map(([value,name])=>`<option value="${escape(value)}" ${v===value?'selected':''}>${escape(name)}</option>`).join('')}</select>`;
    else if(c.kind==='color')input=`<input ${attr} type="color" value="${escape(v)}">`;
    else if(c.kind==='toggle')input=`<input ${attr} type="checkbox" ${v?'checked':''}>`;
    else input=`<input ${attr} type="range" min="${c.min}" max="${c.max}" step="${c.step??.01}" value="${v}">`;
    return `<label class="control" for="${id}"><span>${escape(c.label)}</span><output for="${id}">${format(c,v)}</output>${input}${description}</label>`;
  }).join('');syncControls(kind);
}
function syncControls(kind){
  for(const input of document.querySelectorAll(`[data-controls=${kind}] [data-key]`)){
    const c=controls[kind].find(c=>c.key===input.dataset.key);if(!c)continue;const v=state[kind][c.key];
    if(input.type==='checkbox')input.checked=Boolean(v);else if(document.activeElement!==input&&String(input.value)!==String(v))input.value=v;
    input.closest('.control').querySelector('output').textContent=format(c,v);
    if(input.type==='range')input.style.setProperty('--fill',`${(v-c.min)/(c.max-c.min)*100}%`);
  }
}
function refreshControls(){buildTabs('sound');buildTabs('appearance');refreshPresets();}
function rememberAppearance(){if(changeBefore&&JSON.stringify(changeBefore)!==JSON.stringify(state.appearance)){undo.push(changeBefore);if(undo.length>35)undo.shift();}changeBefore=null;$('undo-look').disabled=!undo.length;}
function refreshPresets(){const select=$('appearance-preset');select.innerHTML='<option value="reference">Reference</option><option value="custom">Current</option>'+looks.map((look,i)=>`<option value="${i}">${escape(look.name)}</option>`).join('');select.value=JSON.stringify(state.appearance)===JSON.stringify(definition.defaultAppearance)?'reference':'custom';$('undo-look').disabled=!undo.length;}
function applyAppearance(next,history=true){if(!definition)return;if(history){undo.push({...state.appearance});if(undo.length>35)undo.shift();}state.appearance=sanitize(definition.defaultAppearance,controls.appearance,next);controller?.update?.(null,'appearance');syncControls('appearance');refreshPresets();save();}

for(let midi=48;midi<60;midi++){const option=document.createElement('option');option.value=midi;option.textContent=noteName(midi).replace(/\d+$/,'');$('root').append(option);}
const tempo=createTempoControl($('tempo-control'));
const panels=createFloatingPanels([
  {id:'sound-popover',name:'Sound',trigger:'sound-toggle',header:'.panel-heading',focus:'select,input',width:400,beforeOpen:()=>{closeDisclosure('performance-popover');closeDisclosure('collection-menu');syncControls('sound');}},
  {id:'appearance',name:'Appearance',trigger:'appearance-toggle',header:'.panel-heading',focus:'select,input',width:440,beforeOpen:()=>{closeDisclosure('performance-popover');closeDisclosure('collection-menu');syncControls('appearance');}},
],{storageKey:'duo.collection.panels.v1'});
const pwa=setupPWA({isPlaying:()=>{const snapshot=audio.snapshot();return state.playing||state.hold||pointers.size>0||keys.size>0||panels.dragging||tempo.active||snapshot.rms>.002||snapshot.voices.some(v=>v.level>.01);},onToast:toast});
const secondary=enableSecondaryButtonTaps();

async function loadInstrument(id){
  const entry=INSTRUMENTS.find(item=>item.id===id&&item.load)||INSTRUMENTS[1];const token=++loadToken;
  saveNow();panic();controller?.destroy?.();controller=null;definition=null;stage.replaceChildren();stage.setAttribute('aria-busy','true');setStatus('Loading');closeDisclosure('collection-menu');$('play').disabled=true;document.querySelectorAll('.settings-panel').forEach(panel=>panel.inert=true);
  try{
    const module=await entry.load();if(token!==loadToken)return;
    definition=module.definition;currentId=entry.id;groups={sound:'',appearance:''};undo=[];changeBefore=null;
    controls.sound=[...new Map([...(definition.commonSoundControls===false?[]:COMMON_SOUND),...(definition.soundControls||[])].map(c=>[c.key,c])).values()];controls.appearance=definition.appearanceControls||[];
    const raw=safeRead(storageKey())||{},soundDefaults={...BASE_SOUND,...definition.defaultSound};
    state={bpm:clamp(Number(raw.bpm)||112,40,220),root:clamp(Number(raw.root)||50,48,59),scale:Object.hasOwn(SCALES,raw.scale)?raw.scale:'dorian',playing:false,hold:false,arp:Boolean(raw.arp),arpRate:[4,8,16].includes(raw.arpRate)?raw.arpRate:8,sound:sanitize(soundDefaults,controls.sound,migrateSound(currentId,raw,soundDefaults)),appearance:sanitize(definition.defaultAppearance||{},controls.appearance,migrateAppearance(currentId,raw,definition.defaultAppearance))};
    looks=(safeRead(`duo.instrument.${currentId}.looks.v1`)||[]);if(!Array.isArray(looks))looks=[];looks=looks.filter(v=>v&&typeof v.name==='string'&&v.appearance).slice(0,30);
    applyTheme();audio.configure(state.sound,{replace:true});performanceState();
    const api={get state(){return state;},audio,quantize,noteName,save,setStatus,toast,setSound,get reducedMotion(){return matchMedia('(prefers-reduced-motion: reduce)').matches;},noteOn:(id,midi,options={})=>audio.noteOn(id,midi,{...state.sound,...options}),noteUpdate:(id,midi,options={})=>audio.noteUpdate(id,midi,{...state.sound,...options}),noteOff:id=>audio.noteOff(id)};
    controller=module.mount(stage,api);if(raw.data!==undefined)controller.setData?.(raw.data);
    document.title=definition.name;$('instrument-name').textContent=definition.name;stage.dataset.instrument=currentId;stage.removeAttribute('aria-busy');$('play').disabled=false;document.querySelectorAll('.settings-panel').forEach(panel=>panel.inert=false);setStatus('');
    $('arp').hidden=definition.performance?.arp===false;$('hold').hidden=definition.performance?.hold===false;
    refreshLibrary();refreshControls();syncTransport();transport();
    try{localStorage.setItem('duo.collection.current',currentId);}catch{}
    if(location.hash!==`#${currentId}`)history.replaceState(null,'',`#${currentId}`);
    window.dispatchEvent(new CustomEvent('duo:instrument',{detail:{id:currentId}}));
  }catch(error){if(token!==loadToken)return;console.error(error);stage.removeAttribute('aria-busy');stage.innerHTML='<div class="load-error">Instrument could not load.<br><button type="button">Retry</button></div>';stage.querySelector('button').onclick=()=>loadInstrument(entry.id);setStatus('Load error');toast('Instrument could not load. Choose another or retry.');}
}

$('play').addEventListener('click',togglePlay);
$('bpm').addEventListener('input',()=>{state.bpm=clamp(Number($('bpm').value),40,220);performanceState();transport();save();});
$('arp').addEventListener('click',()=>{state.arp=!state.arp;performanceState();syncTransport();save();});
$('hold').addEventListener('click',()=>{state.hold=!state.hold;performanceState();syncTransport();});
for(const id of ['root','scale','arp-rate'])$(id).addEventListener('change',()=>{if(id==='scale')state.scale=$('scale').value;else if(id==='root')state.root=Number($('root').value);else state.arpRate=Number($('arp-rate').value);performanceState();controller?.update?.(id,'performance');syncTransport();save();});
$('collection-toggle').addEventListener('click',()=>{const open=$('collection-menu').hidden;closeDisclosure('performance-popover');$('collection-menu').hidden=!open;$('collection-toggle').setAttribute('aria-expanded',String(open));if(open)$('collection-menu').querySelector('[aria-current=true]')?.focus({preventScroll:true});});
$('performance-toggle').addEventListener('click',()=>{const open=$('performance-popover').hidden;closeDisclosure('collection-menu');$('performance-popover').hidden=!open;$('performance-toggle').setAttribute('aria-expanded',String(open));});
$('sound-toggle').addEventListener('click',()=>panels.toggle('sound-popover'));$('appearance-toggle').addEventListener('click',()=>panels.toggle('appearance'));
document.addEventListener('click',e=>{const close=e.target.closest('[data-close]');if(close){const id=close.dataset.close;if(id==='collection-menu'||id==='performance-popover')closeDisclosure(id,true);else panels.close(id,true);}const tab=e.target.closest('[data-group]');if(tab){const kind=tab.parentElement.dataset.tabs;rememberAppearance();groups[kind]=tab.dataset.group;buildTabs(kind);}});
document.addEventListener('keydown',e=>{
  const tabs=e.target.closest('[data-tabs]'),library=e.target.closest('#collection-list');
  if(!tabs&&!library)return;
  const names=tabs?['ArrowLeft','ArrowRight','Home','End']:['ArrowUp','ArrowDown','Home','End'];
  if(!names.includes(e.key))return;e.preventDefault();
  const items=[...(tabs||library).querySelectorAll(tabs?'[role=tab]':'a')],index=items.indexOf(document.activeElement);
  const next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key===names[1]?1:-1)+items.length)%items.length;
  if(tabs){const kind=tabs.dataset.tabs;rememberAppearance();groups[kind]=items[next].dataset.group;buildTabs(kind);tabs.querySelector('[aria-selected=true]').focus();}
  else items[next]?.focus();
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#collection-menu,#collection-toggle'))closeDisclosure('collection-menu');if(!e.target.closest('#performance-popover,#performance-toggle'))closeDisclosure('performance-popover');if(stage.contains(e.target)){pointers.add(e.pointerId);unlockFromGesture();}},{capture:true});
document.addEventListener('pointerup',e=>{if(pointers.has(e.pointerId)&&e.pointerType!=='mouse')unlockFromGesture(true);pointers.delete(e.pointerId);},{capture:true});
document.addEventListener('pointercancel',e=>pointers.delete(e.pointerId),{capture:true});
stage.addEventListener('touchend',()=>unlockFromGesture(true),{capture:true,passive:true});
document.addEventListener('input',e=>{const input=e.target,key=input.dataset.key,kind=input.dataset.kind;if(!key||!kind)return;const c=controls[kind].find(c=>c.key===key);if(!c)return;if(kind==='appearance'&&!changeBefore)changeBefore={...state.appearance};const value=c.kind==='toggle'?input.checked:c.kind==='select'||c.kind==='color'?input.value:Number(input.value);state[kind][key]=value;if(kind==='sound')audio.configure({[key]:value});controller?.update?.(key,kind);syncControls(kind);if(kind==='appearance')$('appearance-preset').value='custom';save();});
document.addEventListener('change',e=>{if(e.target.dataset.kind==='appearance')rememberAppearance();});
$('appearance-preset').addEventListener('change',e=>{if(e.target.value==='reference')applyAppearance(definition.defaultAppearance);else if(e.target.value!=='custom')applyAppearance(looks[Number(e.target.value)]?.appearance||definition.defaultAppearance);});
$('reset-look').addEventListener('click',()=>applyAppearance(definition.defaultAppearance));$('undo-look').addEventListener('click',()=>{if(undo.length)applyAppearance(undo.pop(),false);});
$('save-look').addEventListener('click',()=>{$('save-look-form').hidden=false;$('look-name').focus();});$('cancel-save').addEventListener('click',()=>{$('save-look-form').hidden=true;});
$('save-look-form').addEventListener('submit',e=>{e.preventDefault();const name=$('look-name').value.trim();if(!name)return;looks.unshift({name:name.slice(0,40),appearance:{...state.appearance}});looks=looks.slice(0,30);try{localStorage.setItem(`duo.instrument.${currentId}.looks.v1`,JSON.stringify(looks));}catch{toast('Preset could not be saved');return;}$('save-look-form').hidden=true;$('look-name').value='';refreshPresets();$('appearance-preset').value='0';toast('Appearance saved');});
$('export-look').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({format:'duo-instrument',...persisted()},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${currentId}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('import-look').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;const importId=currentId;try{if(file.size>500000)throw new Error();const data=JSON.parse(await file.text());if(importId!==currentId)return;if(data.format!=='duo-instrument'||data.schema!==1||data.instrument!==currentId)throw new Error();panic();state.sound=sanitize({...BASE_SOUND,...definition.defaultSound},controls.sound,data.sound);applyAppearance(data.appearance);if(data.data!==undefined)controller?.setData?.(data.data);state.bpm=clamp(Number(data.bpm)||state.bpm,40,220);if(Object.hasOwn(SCALES,data.scale))state.scale=data.scale;state.root=clamp(Number(data.root)||state.root,48,59);state.arp=Boolean(data.arp);if([4,8,16].includes(data.arpRate))state.arpRate=data.arpRate;audio.configure(state.sound,{replace:true});performanceState();refreshControls();syncTransport();save();toast('Instrument settings imported');}catch{toast('Choose an export for this instrument');}finally{e.target.value='';}});
function syncFullscreen(){$('fullscreen').hidden=!pwa.canFullscreen;$('fullscreen').textContent=pwa.fullscreen?'Exit fullscreen':'Enter fullscreen';}
$('fullscreen').addEventListener('click',()=>pwa.toggleFullscreen());window.addEventListener('duo:pwa',syncFullscreen);syncFullscreen();
const musicalKeys='asdfghjk';
document.addEventListener('keydown',e=>{if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,select,textarea,[contenteditable=true]'))return;if(e.key==='Escape'){if(!$('collection-menu').hidden){closeDisclosure('collection-menu',true);return;}if(!$('performance-popover').hidden){closeDisclosure('performance-popover',true);return;}if(panels.closeActive(true))return;panic();return;}if(e.code==='Space'){if(e.target.closest('button,a,summary'))return;e.preventDefault();if(!e.repeat)togglePlay();return;}const degree=musicalKeys.indexOf(e.key.toLowerCase());if(degree<0||e.repeat||!controller||definition?.commonSoundControls===false)return;e.preventDefault();keys.add(e.key.toLowerCase());audio.start();audio.noteOn('key-'+e.key.toLowerCase(),quantize(degree),state.sound);});
document.addEventListener('keyup',e=>{const key=e.key.toLowerCase();if(keys.delete(key))audio.noteOff('key-'+key);});
window.addEventListener('hashchange',()=>loadInstrument(location.hash.slice(1)));window.addEventListener('resize',()=>controller?.resize?.());
document.addEventListener('visibilitychange',()=>{if(document.hidden){panic();saveNow();}});window.addEventListener('blur',()=>panic());
window.addEventListener('pagehide',()=>{saveNow();panic();});
window.addEventListener('beforeunload',()=>{cancelAnimationFrame(raf);controller?.destroy?.();audio.dispose();pwa.destroy();tempo.destroy();secondary();});
function frame(ms){raf=requestAnimationFrame(frame);const t=ms/1000,dt=clamp(t-(lastTime||t),0,.05);lastTime=t;if(document.hidden)return;try{controller?.frame?.(t,dt);}catch(error){console.error(error);controller?.destroy?.();controller=null;panic();toast('Instrument renderer stopped. Switch instruments to reload.');}if(t-lastSync>.15){lastSync=t;if(!$('sound-popover').hidden)syncControls('sound');if(!$('appearance').hidden)syncControls('appearance');}}
refreshLibrary();let initial=location.hash.slice(1);if(!initial)try{initial=localStorage.getItem('duo.collection.current')||'carrier';}catch{initial='carrier';}loadInstrument(initial);raf=requestAnimationFrame(frame);
