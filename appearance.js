import { DEFAULT_VISUAL, LOOKS, VISUAL_SURFACES, VISUAL_GROUPS, VISUAL_CONTROLS, sanitiseVisual, formatVisualValue } from './visual-config.js';

const icon = {
  undo:'<path d="M6 3 2 7l4 4M2 7h7a5 5 0 0 1 0 10"/>',
  redo:'<path d="m14 3 4 4-4 4m4-4h-7a5 5 0 0 0 0 10"/>',
  save:'<path d="M4 2h11l3 3v13H2V2h2Zm1 0v6h9V2M5 18v-7h10v7"/>',
  download:'<path d="M10 2v11m-4-4 4 4 4-4M3 14v4h14v-4"/>',
  upload:'<path d="M10 14V3M6 7l4-4 4 4M3 14v4h14v-4"/>',
  lock:'<rect x="5" y="9" width="10" height="9" rx="1"/><path d="M7 9V6a3 3 0 0 1 6 0v3m-3 4v2"/>',
  unlock:'<rect x="5" y="9" width="10" height="9" rx="1"/><path d="M7 9V6a3 3 0 0 1 6 0m-3 7v2"/>',
  reset:'<path d="M4 6a7 7 0 1 1-1 8M4 2v5h5"/>',
  dice:'<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M6 6h.1M14 6h.1M10 10h.1M6 14h.1M14 14h.1" stroke-width="2.6"/>',
  pause:'<path d="M7 4v12M13 4v12" stroke-width="3"/>',
  play:'<path d="m6 3 10 7-10 7Z"/>',
};
const svg = name => `<svg viewBox="0 0 20 20" aria-hidden="true">${icon[name] || ''}</svg>`;
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const clamp = (value,min,max) => Math.min(max,Math.max(min,value));
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORAGE_KEY = 'duo-visual-looks-v1';

export function createAppearance(container, {getVisual,setVisual,getLook,setLook,onToast=()=>{},getFullscreen=()=>({available:false,active:false}),onFullscreen=()=>{}}) {
  const controller = new AbortController();
  const events = {signal:controller.signal};
  let group = 'grid', advanced = false, activeSlot = 'A', strength = .22, pending = null;
  let undo = [], redo = [], saved = [], selectedSaved = '', renderedControls = '';
  const locks = new Set();
  const surfaceGroups = Object.fromEntries(VISUAL_SURFACES.map(surface=>[surface.id,surface.groups[0]]));
  const read = () => sanitiseVisual(getVisual());
  const snapshot = () => ({visual:clone(read()),look:LOOKS[getLook()] ? getLook() : 'ember'});
  const slots = {A:snapshot(),B:snapshot()};
  const slotHistory = {A:{undo:[],redo:[]},B:{undo:[],redo:[]}};
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(raw)) saved = raw.slice(0,30).filter(p=>p && typeof p.id==='string' && typeof p.name==='string' && p.visual).map(p=>({...p,name:p.name.slice(0,40),visual:sanitiseVisual(p.visual),look:LOOKS[p.look]?p.look:'ember'}));
  } catch {}

  container.classList.add('appearance-editor');
  container.innerHTML = `
    <div class="ae-top"><h2 class="ae-heading">Appearance</h2><button type="button" class="icon-button" data-close="appearance" aria-label="Close appearance settings">×</button></div>
    <div class="ae-preset-row">
      <select class="ae-look" aria-label="Visual look"></select>
      <div class="ae-toolbar">
        <button type="button" class="ae-button" data-action="undo" aria-label="Undo appearance change" title="Undo">${svg('undo')}</button>
        <button type="button" class="ae-button" data-action="redo" aria-label="Redo appearance change" title="Redo">${svg('redo')}</button>
        <button type="button" class="ae-button" data-action="save" aria-label="Save this look" title="Save look">${svg('save')}</button>
      </div>
    </div>
    <form class="ae-save-form" hidden><input aria-label="Name your look" maxlength="40" placeholder="Name this look" required autocomplete="off"><button type="submit" class="ae-button">Save</button><button type="button" class="ae-button" data-action="cancel-save" aria-label="Cancel saving">×</button></form>
    <div class="ae-surfaces" role="tablist" aria-label="Appearance surface">${VISUAL_SURFACES.map(surface=>`<button type="button" class="ae-surface" id="appearance-surface-${surface.id}" data-surface="${surface.id}" role="tab" aria-controls="appearance-panel" aria-selected="${surface.id==='galaxy'}" tabindex="${surface.id==='galaxy'?0:-1}">${surface.name}</button>`).join('')}</div>
    <div class="ae-tabs">
      <select id="appearance-group" class="ae-group" aria-label="Settings category"></select><span class="ae-category-name" aria-hidden="true"></span>
      <div class="ae-group-tools"><button type="button" class="ae-button" data-action="advanced" aria-expanded="false">More +</button><button type="button" class="ae-button" data-action="lock" aria-label="Lock Galaxy during mutation" aria-pressed="false" title="Lock group">${svg('unlock')}</button><button type="button" class="ae-button" data-action="reset-group" aria-label="Reset Galaxy" title="Reset group">${svg('reset')}</button></div>
    </div>
    <div class="ae-scroll">
      <div class="ae-body" id="appearance-panel" role="tabpanel" aria-labelledby="appearance-surface-galaxy"></div>
      <section class="ae-tools" id="appearance-tools" aria-label="Look tools" hidden>
        <div class="ae-tool-actions"><button type="button" class="ae-button" data-action="export">${svg('download')}Export</button><button type="button" class="ae-button" data-action="import">${svg('upload')}Import</button><button type="button" class="ae-button" data-action="reset-all">${svg('reset')}Reset look</button></div>
        <p class="ae-tools-description">Freeze holds the visuals while sound continues. Pattern seed repeats generated scene details; mutation changes appearance only.</p><div class="ae-time-tools"><label class="ae-phase">Phase<input type="range" min="0" max="1" step=".001" value="0" aria-label="Frozen animation phase"></label><label class="ae-seed" title="Repeats the generated ring, galaxy and trail patterns">Pattern seed<input type="number" min="0" max="2147483646" step="1" aria-label="Visual random seed" value="42"></label></div>
        <div class="ae-mutation"><select class="ae-target" aria-label="Mutation target"><option value="group">This group</option><option value="all">All unlocked</option></select><label class="ae-strength" title="Mutation strength"><span>22%</span><input type="range" min=".03" max=".75" step=".01" value=".22" aria-label="Mutation strength"></label><button type="button" class="ae-button ae-mutate" data-action="mutate">${svg('dice')}Mutate</button></div>
      </section>
    </div>
    <div class="ae-bottom">
      <button type="button" class="ae-button" data-action="freeze" aria-pressed="false" title="Freeze visual motion">Freeze</button>
      <div class="ae-ab" role="group" aria-label="Compare looks"><button type="button" class="ae-button active" data-action="slot-A" aria-pressed="true" title="Compare slot A">A</button><button type="button" class="ae-button" data-action="slot-B" aria-pressed="false" title="Compare slot B">B</button></div>
      <button type="button" class="ae-button ae-tools-toggle" data-action="tools" aria-expanded="false" aria-controls="appearance-tools">Tools <span aria-hidden="true">＋</span></button>
    </div>
    <input class="ae-import" type="file" accept="application/json,.json" hidden>
    <span class="ae-announcement" aria-live="polite"></span>`;

  const q = selector => container.querySelector(selector);
  const body = q('.ae-body'), lookSelect = q('.ae-look'), saveForm = q('.ae-save-form');
  function announce(message) { q('.ae-announcement').textContent=message; onToast(message); }
  function refreshLooks() {
    lookSelect.innerHTML = '';
    const builtins=document.createElement('optgroup'); builtins.label='Studio';
    for (const [key,value] of Object.entries(LOOKS)) { const option=document.createElement('option'); option.value=key;option.textContent=value.name;builtins.append(option); }
    lookSelect.append(builtins);
    if(saved.length){const custom=document.createElement('optgroup');custom.label='Your looks';for(const p of saved){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;custom.append(option);}lookSelect.append(custom);}
    lookSelect.value=selectedSaved || getLook() || 'ember';
  }
  function push(before) {
    if (!before || equal(before,snapshot())) return;
    undo.push(before); if(undo.length>60)undo.shift(); redo=[]; selectedSaved='';
  }
  function commit() { if(pending){push(pending);pending=null;}refresh(); }
  function apply(next,record=true) {
    const before=snapshot(); setVisual(sanitiseVisual(next));
    if(record)push(before); refresh();
  }
  function restore(value) {
    setLook(value.look); setVisual(sanitiseVisual(value.visual)); selectedSaved='';refresh();
  }
  function setValue(key,value) {
    if(!pending)pending=snapshot();
    setVisual(sanitiseVisual({...read(),[key]:value})); updateControl(key);updateGlobal();
  }
  function updateNavigation() {
    const surface=VISUAL_SURFACES.find(surface=>surface.groups.includes(group));
    surfaceGroups[surface.id]=group;
    for(const tab of container.querySelectorAll('.ae-surface')) {
      const active=tab.dataset.surface===surface.id;
      tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
    }
    const select=q('.ae-group');
    if(select.dataset.surface!==surface.id) {
      select.innerHTML=surface.groups.map(id=>{const g=VISUAL_GROUPS.find(g=>g.id===id);return `<option value="${g.id}">${g.name}</option>`;}).join('');
      select.dataset.surface=surface.id;
    }
    select.value=group;select.hidden=surface.groups.length===1;
    select.setAttribute('aria-label',`${surface.name} settings category`);
    q('.ae-category-name').hidden=surface.groups.length!==1;
    q('.ae-category-name').textContent=VISUAL_GROUPS.find(g=>g.id===group).name;
    body.setAttribute('aria-labelledby',`appearance-surface-${surface.id}`);
  }
  function changeSurface(id) {
    const surface=VISUAL_SURFACES.find(surface=>surface.id===id);if(!surface)return;
    changeGroup(surfaceGroups[id]||surface.groups[0]);
  }
  function renderControls() {
    const g=VISUAL_GROUPS.find(g=>g.id===group);
    const visual=read(),controls=visibleControls(g,visual);renderedControls=controlSignature(controls,visual);
    updateNavigation();
    body.innerHTML=`<p class="ae-group-description">${escape(g.description)}</p>`+controls.map(c=>{
      const id=`appearance-${c.key}`,v=visual[c.key],descriptionId=id+'-description',label=c.labels?.[visual.matrixShape]||c.label;
      const describedBy=descriptionId+(c.hint?' '+id+'-hint':'');
      const description=`<small class="ae-control-description" id="${descriptionId}">${escape(c.descriptions?.[visual.matrixShape]||c.description)}</small>`;
      if(c.type==='text')return `<label class="ae-control ae-copy ${c.maxLength>32?'ae-copy-wide':''}" for="${id}" data-target="${escape(c.target)}"><span class="ae-label">${c.label}</span><input id="${id}" type="text" data-key="${c.key}" maxlength="${c.maxLength}" value="${escape(v)}" autocomplete="off" spellcheck="false" aria-describedby="${describedBy}">${description}${c.hint?`<small id="${id}-hint" class="ae-copy-hint">${c.hint}</small>`:''}</label>`;
      if(c.type==='color')return `<label class="ae-control ae-colour" for="${id}" data-target="${escape(c.target)}"><input id="${id}" type="color" data-key="${c.key}" value="${escape(v)}" aria-label="${c.label} color" aria-describedby="${descriptionId}"><span class="ae-label">${c.label}</span><output class="ae-value" for="${id}">${formatVisualValue(c,v)}</output>${description}</label>`;
      const field=c.type==='select'?`<select id="${id}" data-key="${c.key}" aria-describedby="${descriptionId}">${c.options.map(([key,label])=>`<option value="${key}" ${v===key?'selected':''}>${label}</option>`).join('')}</select>`:`<input id="${id}" type="range" data-key="${c.key}" min="${c.min}" max="${c.max}" step="${c.step}" value="${v}" aria-label="${label}" aria-describedby="${descriptionId}">`;
      return `<label class="ae-control" for="${id}" data-target="${escape(c.target)}"><span class="ae-label">${label}</span><output class="ae-value" for="${id}">${c.type==='select'?'':formatVisualValue(c,v)}</output>${field}${description}</label>`;
    }).join('');
    if(group==='layout'&&getFullscreen().available)body.insertAdjacentHTML('beforeend',`<div class="ae-control ae-display-control"><span class="ae-label">Display</span><button type="button" class="ae-button" data-action="fullscreen" aria-describedby="appearance-fullscreen-description"></button><small class="ae-control-description" id="appearance-fullscreen-description">Use the display area available to this browser.</small></div>`);
    q('[data-action=advanced]').hidden=!g.controls.some(c=>c.advanced);
    updateGlobal();g.controls.forEach(c=>updateControl(c.key));
  }
  function updateControl(key) {
    const control=VISUAL_CONTROLS.find(c=>c.key===key),input=body.querySelector(`[data-key="${key}"]`);
    if(!control||!input)return;
    const value=read()[key];if(String(input.value)!==String(value))input.value=value;
    const output=input.closest('.ae-control').querySelector('output'); if(output)output.textContent=control.type==='select'?'':formatVisualValue(control,value);
    if(control.type==='range')input.style.setProperty('--range-fill',`${(value-control.min)/(control.max-control.min)*100}%`);
  }
  function updateGlobal(){
    const value=read(),g=VISUAL_GROUPS.find(g=>g.id===group);
    q('[data-action=undo]').disabled=!undo.length;q('[data-action=redo]').disabled=!redo.length;
    q('[data-action=freeze]').setAttribute('aria-pressed',String(value.freeze));
    q('[data-action=freeze]').textContent=value.freeze?'Frozen':'Freeze';
    q('.ae-phase input').value=value.phase;q('.ae-phase input').style.setProperty('--range-fill',`${value.phase*100}%`);
    if(document.activeElement!==q('.ae-seed input'))q('.ae-seed input').value=value.seed;
    const lock=q('[data-action=lock]');lock.hidden=['microcopy','layout'].includes(group);lock.setAttribute('aria-pressed',String(locks.has(group)));lock.setAttribute('aria-label',`${locks.has(group)?'Unlock':'Lock'} ${g.name} during mutation`);lock.innerHTML=svg(locks.has(group)?'lock':'unlock');
    q('[data-action=reset-group]').setAttribute('aria-label',`Reset ${g.name}`);
    q('.ae-group').value=group;
    q('[data-action=mutate]').disabled=['microcopy','layout'].includes(group)&&q('.ae-target').value==='group';
    q('[data-action=advanced]').setAttribute('aria-expanded',String(advanced));q('[data-action=advanced]').textContent=advanced?'Less −':'More +';
    q('[data-action=slot-A]').classList.toggle('active',activeSlot==='A');q('[data-action=slot-B]').classList.toggle('active',activeSlot==='B');
    q('[data-action=slot-A]').setAttribute('aria-pressed',String(activeSlot==='A'));q('[data-action=slot-B]').setAttribute('aria-pressed',String(activeSlot==='B'));
    q('.ae-strength input').style.setProperty('--range-fill',`${(strength-.03)/.72*100}%`);
    const currentSaved=saved.find(p=>p.id===selectedSaved);if(currentSaved&&!equal(currentSaved.visual,read()))selectedSaved='';
    lookSelect.value=selectedSaved||getLook()||'ember';
    const fullscreen=q('[data-action=fullscreen]');if(fullscreen){fullscreen.textContent=getFullscreen().active?'Exit fullscreen':'Enter fullscreen';fullscreen.setAttribute('aria-pressed',String(getFullscreen().active));}
  }
  function visibleControls(g,visual){return g.controls.filter(c=>(!c.advanced||advanced)&&(!c.onlyWhen||visual[c.onlyWhen.key]===c.onlyWhen.value)&&(!c.exceptWhen||visual[c.exceptWhen.key]!==c.exceptWhen.value));}
  function controlSignature(controls,visual){return group+'|'+advanced+'|'+visual.matrixShape+'|'+(group==='layout'&&getFullscreen().available)+'|'+controls.map(c=>c.key).join(',');}
  function refresh(){
    const visual=read(),g=VISUAL_GROUPS.find(g=>g.id===group);
    if(renderedControls!==controlSignature(visibleControls(g,visual),visual)){
      const focused=body.contains(document.activeElement)?document.activeElement?.dataset.key:null,top=q('.ae-scroll').scrollTop;
      renderControls();if(focused)body.querySelector(`[data-key="${focused}"]`)?.focus({preventScroll:true});q('.ae-scroll').scrollTop=top;
    }else{VISUAL_CONTROLS.forEach(c=>updateControl(c.key));updateGlobal();}
  }
  function changeGroup(id){if(!VISUAL_GROUPS.some(g=>g.id===id))return;commit();group=id;renderControls();q('.ae-scroll').scrollTop=0;}
  function mutate(){
    commit();const value=read();let seed=value.seed||1;
    const targets=(q('.ae-target').value==='all'?VISUAL_GROUPS:VISUAL_GROUPS.filter(g=>g.id===group)).filter(g=>!['microcopy','layout'].includes(g.id));
    const signature=JSON.stringify(targets.filter(g=>!locks.has(g.id)).map(g=>g.controls.map(c=>[c.key,value[c.key]])));
    for(let i=0;i<signature.length;i++)seed=Math.imul(seed^signature.charCodeAt(i),16777619)>>>0;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    let changes=0;
    for(const g of targets){if(locks.has(g.id))continue;for(const c of g.controls){
      if(c.key==='centreGap'||c.key==='labelScale')continue;
      if(c.type==='range'){const delta=(random()+random()-1)*(c.max-c.min)*strength;value[c.key]=Math.round(clamp(value[c.key]+delta,c.min,c.max)/c.step)*c.step;changes++;}
      else if(c.type==='color'&&c.key!=='fg'&&c.key!=='bg'){const original=value[c.key].slice(1).match(/.{2}/g).map(n=>parseInt(n,16));value[c.key]='#'+original.map(n=>Math.round(clamp(n+(random()-.5)*110*strength,0,255)).toString(16).padStart(2,'0')).join('');changes++;}
    }}
    if(!changes){announce(['microcopy','layout'].includes(group)?'Labels and layout stay unchanged during mutation':'No unlocked controls to mutate');return;}
    apply(value);announce('Variation applied');
  }
  function exportLook(){
    const data={format:'duo-look',version:1,name:LOOKS[getLook()]?.name||'Custom',look:getLook(),visual:read()};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`duo-${String(data.name).toLowerCase().replace(/[^a-z0-9]+/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);announce('Look exported');
  }
  container.addEventListener('click',event=>{
    const surface=event.target.closest('[data-surface]');if(surface?.classList.contains('ae-surface')){changeSurface(surface.dataset.surface);return;}
    const button=event.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action;commit();
    if(action==='tools'){const tools=q('.ae-tools');tools.hidden=!tools.hidden;button.setAttribute('aria-expanded',String(!tools.hidden));button.innerHTML=tools.hidden?'Tools <span aria-hidden="true">＋</span>':'Tools <span aria-hidden="true">−</span>';if(!tools.hidden)q('.ae-scroll').scrollTop=q('.ae-scroll').scrollHeight;}
    else if(action==='fullscreen'){onFullscreen();}
    else if(action==='advanced'){advanced=!advanced;renderControls();}
    else if(action==='lock'){locks.has(group)?locks.delete(group):locks.add(group);updateGlobal();}
    else if(action==='reset-group'){const defaults=LOOKS[getLook()]?.visual||DEFAULT_VISUAL,next=read();for(const c of VISUAL_GROUPS.find(g=>g.id===group).controls)next[c.key]=defaults[c.key];apply(next);}
    else if(action==='reset-all'){apply(LOOKS[getLook()]?.visual||DEFAULT_VISUAL);announce('Look reset');}
    else if(action==='undo'&&undo.length){redo.push(snapshot());restore(undo.pop());}
    else if(action==='redo'&&redo.length){undo.push(snapshot());restore(redo.pop());}
    else if(action.startsWith('slot-')){const next=action.slice(-1);if(next!==activeSlot){slots[activeSlot]=snapshot();slotHistory[activeSlot]={undo,redo};activeSlot=next;undo=slotHistory[next].undo;redo=slotHistory[next].redo;restore(slots[next]);refresh();}}
    else if(action==='freeze'){apply({...read(),freeze:!read().freeze});}
    else if(action==='mutate')mutate();
    else if(action==='export')exportLook();
    else if(action==='import')q('.ae-import').click();
    else if(action==='save'){saveForm.hidden=false;saveForm.querySelector('input').value='';saveForm.querySelector('input').focus();}
    else if(action==='cancel-save'){saveForm.hidden=true;q('[data-action=save]').focus();}
  },events);
  body.addEventListener('input',event=>{const key=event.target.dataset.key;if(!key)return;setValue(key,event.target.type==='range'?Number(event.target.value):event.target.value);},events);
  body.addEventListener('change',commit,events);
  q('.ae-group').addEventListener('change',event=>changeGroup(event.target.value),events);
  q('.ae-surfaces').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=[...q('.ae-surfaces').querySelectorAll('[role=tab]')],index=tabs.indexOf(event.target);if(index<0)return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    changeSurface(tabs[next].dataset.surface);tabs[next].focus();
  },events);
  q('.ae-target').addEventListener('change',updateGlobal,events);
  body.addEventListener('dblclick',event=>{const key=event.target.dataset.key;if(!key)return;commit();apply({...read(),[key]:(LOOKS[getLook()]?.visual||DEFAULT_VISUAL)[key]});},events);
  lookSelect.addEventListener('change',()=>{const value=lookSelect.value;commit();const before=snapshot();if(LOOKS[value]){setLook(value);setVisual({...LOOKS[value].visual});selectedSaved='';}else{const found=saved.find(p=>p.id===value);if(!found)return;setLook(found.look);setVisual({...found.visual});selectedSaved=found.id;}push(before);if(!LOOKS[value])selectedSaved=value;refresh();},events);
  q('.ae-phase input').addEventListener('input',event=>{if(!pending)pending=snapshot();setVisual({...read(),freeze:true,phase:Number(event.target.value)});updateGlobal();},events);
  q('.ae-phase input').addEventListener('change',commit,events);
  q('.ae-seed input').addEventListener('change',event=>{apply({...read(),seed:Number(event.target.value)});},events);
  q('.ae-strength input').addEventListener('input',event=>{strength=Number(event.target.value);q('.ae-strength span').textContent=`${Math.round(strength*100)}%`;updateGlobal();},events);
  saveForm.addEventListener('submit',event=>{
    event.preventDefault();const name=saveForm.querySelector('input').value.trim();if(!name)return;
    const id='saved-'+Date.now().toString(36);saved.unshift({id,name:name.slice(0,40),...snapshot()});saved=saved.slice(0,30);
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(saved));selectedSaved=id;saveForm.hidden=true;refreshLooks();q('[data-action=save]').focus();announce('Look saved');}catch{announce('Could not save: browser storage is full');}
  },events);
  q('.ae-import').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{
      if(file.size>100000)throw new Error('too large');const data=JSON.parse(await file.text());
      if(data.format!=='duo-look'||data.version!==1||!data.visual||typeof data.visual!=='object'||Array.isArray(data.visual))throw new Error('format');
      const before=snapshot(),look=LOOKS[data.look]?data.look:'ember';setLook(look);setVisual(sanitiseVisual(data.visual,LOOKS[look].visual));push(before);refresh();announce('Look imported');
    }catch{announce('Choose a valid DUO look JSON file');}finally{event.target.value='';}
  },events);
  container.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.target.matches('input:not([type=range])')){event.preventDefault();q(`[data-action="${event.shiftKey?'redo':'undo'}"]`).click();}
    if(event.key==='Escape'&&!saveForm.hidden){event.preventDefault();event.stopPropagation();saveForm.hidden=true;q('[data-action=save]').focus();}
  },events);
  window.addEventListener('duo:pwa',refresh,events);
  refreshLooks();renderControls();
  return {refresh,destroy(){controller.abort();container.innerHTML='';}};
}
