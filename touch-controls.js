// A secondary finger does not synthesize a click in every mobile browser.
// Keep one finger playing while another taps an explicit instrument button.
export function enableSecondaryButtonTaps(root = document) {
  const selector = '#performance-toggle,#hold,#arp,#sound-toggle,#appearance-toggle,#play,[data-close],[data-waveform]';
  const pending = new Map(), completed = new Map(), lastDown = new WeakMap();
  const controller = new AbortController(), options = {capture:true, signal:controller.signal};
  const buttonAt = target => target?.closest?.('button')?.matches(selector) ? target.closest('button') : null;
  const available = button => button && button.isConnected && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  const now = () => performance.now();
  const clear = () => {pending.clear();completed.clear();};
  root.addEventListener('pointerdown', event => {
    const button = buttonAt(event.target);if (!button) return;
    const time = now();lastDown.set(button,time);
    const history = (completed.get(button)||[]).filter(tap => tap.pointerId !== event.pointerId && time-tap.time<700);
    if(history.length)completed.set(button,history);else completed.delete(button);
    if(event.pointerType !== 'touch' || event.isPrimary !== false || !available(button))return;
    pending.set(event.pointerId,{button,x:event.clientX,y:event.clientY});
  },options);
  root.addEventListener('pointermove', event => {
    const tap=pending.get(event.pointerId);
    if(tap && Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>10)pending.delete(event.pointerId);
  },options);
  root.addEventListener('pointerup', event => {
    const tap=pending.get(event.pointerId);pending.delete(event.pointerId);if(!tap)return;
    if(!available(tap.button)||buttonAt(event.target)!==tap.button||Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>10)return;
    // Touch has implicit capture, so pointerup.target alone does not prove the
    // finger was released over the button it first pressed.
    if(buttonAt(root.elementFromPoint(event.clientX,event.clientY))!==tap.button)return;
    const history=(completed.get(tap.button)||[]).filter(item=>now()-item.time<700);
    history.push({...tap,pointerId:event.pointerId,time:now()});completed.set(tap.button,history.slice(-8));
    event.preventDefault();tap.button.click();
  },options);
  for(const type of ['pointercancel','lostpointercapture'])root.addEventListener(type,event=>pending.delete(event.pointerId),options);
  root.addEventListener('click', event => {
    if(!event.isTrusted || (event.detail===0&&!event.pointerType))return; // Explicit .click() and keyboard activation pass through.
    const button=buttonAt(event.target),history=completed.get(button);if(!history)return;
    const time=now(),hasPointer=Number.isFinite(event.pointerId)&&event.pointerId>=0;
    const index=history.findIndex(tap=>time-tap.time<700 && (hasPointer
      ? event.pointerId===tap.pointerId
      : (lastDown.get(button)||0)<=tap.time && Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<=12));
    if(index<0){completed.set(button,history.filter(tap=>time-tap.time<700));return;}
    history.splice(index,1);if(!history.length)completed.delete(button);
    event.preventDefault();event.stopImmediatePropagation();
  },options);
  root.addEventListener('visibilitychange',()=>{if(root.hidden)clear();},{signal:controller.signal});
  root.defaultView?.addEventListener('blur',clear,{signal:controller.signal});
  return () => {controller.abort();clear();};
}
