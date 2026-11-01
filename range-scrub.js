const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function rangeValueAt(input,clientX,rect=input.getBoundingClientRect()){
  const min=Number(input.min)||0,max=Number.isFinite(Number(input.max))&&input.max!==''?Number(input.max):100;
  const step=input.step==='any'?0:Math.abs(Number(input.step))||1;
  const inset=Math.min(6,Math.max(0,rect.width*.1)),width=Math.max(1,rect.width-inset*2);
  let value=min+clamp((clientX-rect.left-inset)/width,0,1)*(max-min);
  if(step)value=min+Math.round((value-min)/step)*step;
  return Number(clamp(value,min,max).toFixed(8));
}

/** Keep dragging after a press anywhere on a native range's track. */
export function enableRangeScrubbing(root=document){
  const documentRoot=root.ownerDocument||root,win=documentRoot.defaultView;
  const abort=new AbortController(),options={capture:true,signal:abort.signal},active=new Map(),owners=new WeakMap();
  const isRange=target=>target?.matches?.('input[type="range"]')&&!target.disabled&&!target.readOnly&&target.dataset?.nativeRange!=='true';
  const dispatch=(input,type)=>input.dispatchEvent(new Event(type,{bubbles:true}));
  const move=(entry,clientX)=>{
    if(!Number.isFinite(clientX)||!entry.input.isConnected)return;
    const value=String(rangeValueAt(entry.input,clientX,entry.rect));
    if(value===entry.input.value)return;
    entry.input.value=value;entry.changed=true;dispatch(entry.input,'input');
  };
  const finish=id=>{
    const entry=active.get(id);if(!entry)return;active.delete(id);owners.delete(entry.input);
    if(entry.input.hasPointerCapture?.(id))entry.input.releasePointerCapture(id);
    if(entry.changed)dispatch(entry.input,'change');
  };
  root.addEventListener('pointerdown',event=>{
    const input=event.target;if(!isRange(input)||owners.has(input)||(event.pointerType==='mouse'&&event.button!==0))return;
    event.preventDefault();input.focus?.({preventScroll:true});
    const entry={input,rect:input.getBoundingClientRect(),changed:false};active.set(event.pointerId,entry);owners.set(input,event.pointerId);
    input.setPointerCapture?.(event.pointerId);move(entry,event.clientX);
  },options);
  root.addEventListener('pointermove',event=>{const entry=active.get(event.pointerId);if(!entry)return;event.preventDefault();move(entry,event.clientX);},options);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])root.addEventListener(type,event=>{if(active.has(event.pointerId))event.preventDefault();finish(event.pointerId);},options);
  const clear=()=>{for(const id of [...active.keys()])finish(id);};
  documentRoot.addEventListener('visibilitychange',()=>{if(documentRoot.hidden)clear();},{signal:abort.signal});
  win?.addEventListener('blur',clear,{signal:abort.signal});
  const destroy=()=>{clear();abort.abort();};
  Object.defineProperty(destroy,'active',{get:()=>active.size>0});
  return destroy;
}
