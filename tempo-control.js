const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// A momentary tempo scrubber. Horizontal travel is relative to the value at
// pointer-down, so revealing the scale never jumps to the pointer's position.
export function createTempoControl(host) {
  const trigger=host.querySelector('#tempo-trigger'),input=host.querySelector('#bpm');
  const popup=host.querySelector('#tempo-popup'),readout=host.querySelector('#bpm-readout');
  const popupValue=host.querySelector('#tempo-popup-value');
  const doc=host.ownerDocument,win=doc.defaultView;
  const popupParent=popup.parentNode,popupNext=popup.nextSibling;
  // The portrait footer has its own stacking context. Keep this transient
  // slider above floating editors without raising the entire footer.
  doc.body?.append(popup);
  const controller=new AbortController(),options={signal:controller.signal};
  const min=Number(input.min),max=Number(input.max),keys=new Set();
  let pointer=null;
  const value=()=>clamp(Number(input.value)||min,min,max);

  function sync() {
    const current=value();
    readout.textContent=String(current);popupValue.textContent=`${current} BPM`;
    trigger.setAttribute('aria-valuenow',String(current));
    trigger.setAttribute('aria-valuetext',`${current} beats per minute`);
    input.style.setProperty('--fill',`${(current-min)/(max-min)*100}%`);
  }

  function position() {
    const rect=trigger.getBoundingClientRect(),width=Math.min(264,win.innerWidth-24);
    popup.style.width=`${width}px`;
    popup.style.left=`${clamp(rect.left+rect.width/2-width/2,12,win.innerWidth-width-12)}px`;
    popup.style.bottom=`${Math.max(12,win.innerHeight-rect.top+9)}px`;
  }

  function open() {sync();position();host.classList.add('is-open');popup.classList.add('is-open');}
  function change(next) {
    next=clamp(Math.round(next),min,max);
    if(next===value())return;
    input.value=String(next);sync();
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function close() {
    const previous=pointer;pointer=null;keys.clear();host.classList.remove('is-open');popup.classList.remove('is-open');
    if(previous&&trigger.hasPointerCapture?.(previous.id))trigger.releasePointerCapture(previous.id);
    if(previous&&previous.value!==value())input.dispatchEvent(new Event('change',{bubbles:true}));
  }

  trigger.addEventListener('pointerdown',event=>{
    if(pointer||(event.pointerType==='mouse'&&event.button!==0))return;
    event.preventDefault();keys.clear();trigger.focus({preventScroll:true});open();
    // Use the actual track width, including narrow screens, and retain its
    // sensitivity for this gesture even if the viewport changes mid-drag.
    const trackWidth=Math.max(1,input.getBoundingClientRect().width-12);
    pointer={id:event.pointerId,x:event.clientX,value:value(),perPixel:(max-min)/trackWidth};
    trigger.setPointerCapture(event.pointerId);
  },options);
  trigger.addEventListener('pointermove',event=>{
    if(!pointer||event.pointerId!==pointer.id)return;
    event.preventDefault();change(pointer.value+(event.clientX-pointer.x)*pointer.perPixel);
  },options);
  for(const type of ['pointerup','pointercancel','lostpointercapture'])trigger.addEventListener(type,event=>{
    if(pointer?.id!==event.pointerId)return;event.preventDefault();close();
  },options);
  trigger.addEventListener('contextmenu',event=>event.preventDefault(),options);
  trigger.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
    if(pointer||event.altKey||event.ctrlKey||event.metaKey)return;
    const changes={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:-10,PageUp:10};
    if(!Object.hasOwn(changes,event.key)&&!['Home','End',' ','Enter'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();keys.add(event.key);open();
    if(event.key==='Home')change(min);
    else if(event.key==='End')change(max);
    else if(Object.hasOwn(changes,event.key))change(value()+changes[event.key]*(event.shiftKey&&event.key.startsWith('Arrow')?10:1));
  },options);
  trigger.addEventListener('keyup',event=>{
    if(!keys.has(event.key))return;event.preventDefault();event.stopPropagation();keys.delete(event.key);
    if(!keys.size&&!pointer){host.classList.remove('is-open');popup.classList.remove('is-open');input.dispatchEvent(new Event('change',{bubbles:true}));}
  },options);
  trigger.addEventListener('blur',close,options);
  input.addEventListener('input',sync,options);
  input.addEventListener('change',sync,options);
  win.addEventListener('resize',()=>{if(pointer||keys.size)position();},options);
  win.addEventListener('blur',close,options);
  doc.addEventListener('visibilitychange',()=>{if(doc.hidden)close();},options);
  sync();
  return {sync,close,get active(){return!!pointer||keys.size>0;},destroy(){close();controller.abort();popupParent?.insertBefore(popup,popupNext?.parentNode===popupParent?popupNext:null);}};
}
