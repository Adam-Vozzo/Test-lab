/** Size the instrument from an independent CSS viewport, never from its own
 * rendered height. Installed WebKit can report a progressively smaller visual
 * viewport after resume even though its layout viewport has not changed. */
export function installViewportFit(win=window,root=document.documentElement){
  const doc=root.ownerDocument||win.document;
  const modes=['standalone','fullscreen','minimal-ui'].map(mode=>win.matchMedia?.(`(display-mode: ${mode})`)).filter(Boolean);
  const probe=doc?.createElement?.('div');
  if(probe){
    probe.setAttribute('aria-hidden','true');probe.setAttribute('data-viewport-probe','');
    probe.style.cssText='all:initial;display:block;position:fixed;inset:0 auto auto 0;width:0;height:100vh;visibility:hidden;pointer-events:none;overflow:hidden;contain:strict;';
    root.appendChild(probe);
  }
  let frame=0,last=0,disposed=false,suspended=!!doc?.hidden,keyboardSession=false;
  const timers=new Set();
  const textEditor=element=>{
    if(!element||element.disabled||element.readOnly)return false;
    if(element.isContentEditable)return true;
    const tag=element.tagName?.toUpperCase();
    return tag==='TEXTAREA'||tag==='INPUT'&&['text','search','email','url','tel','password','number'].includes(element.type||'text');
  };
  const layoutHeight=()=>{
    if(probe){
      // Unsupported units leave the 100vh fallback in place. Unlike the app,
      // this element never consumes --app-height, so measurement cannot feed
      // a previously reduced size back into the next resume.
      probe.style.height='100vh';
      probe.style.height=win.navigator?.standalone||modes.some(mode=>mode.matches)?'100lvh':'100dvh';
      const height=probe.getBoundingClientRect().height;
      if(Number.isFinite(height)&&height>0)return height;
    }
    return root.clientHeight||win.innerHeight||0;
  };
  const update=()=>{
    frame=0;if(disposed||suspended||doc?.hidden)return;
    const visual=win.visualViewport;
    if(visual&&Math.abs((visual.scale||1)-1)>.01)return;
    const layout=layoutHeight();let height=layout;
    // A visual viewport reduction is meaningful for an active text keyboard,
    // not for ordinary browser chrome, stale resume snapshots, or instrument
    // controls. Backgrounding ends this temporary keyboard sizing session.
    if(keyboardSession&&textEditor(doc?.activeElement)&&visual?.height>0&&layout-visual.height>Math.max(100,layout*.18))height=visual.height;
    height=Math.round(height);
    if(height>0&&height!==last){last=height;root.style.setProperty('--app-height',height+'px');}
  };
  const queue=()=>{if(!frame&&!disposed&&!suspended&&!doc?.hidden)frame=win.requestAnimationFrame(update);};
  const clearPending=()=>{
    if(frame)win.cancelAnimationFrame(frame);frame=0;
    for(const timer of timers)win.clearTimeout(timer);timers.clear();
  };
  const settle=()=>{
    clearPending();queue();
    if(disposed||suspended||doc?.hidden)return;
    // Orientation and PWA resume can publish their final CSS viewport after
    // the first frame. Re-read it briefly; no historical maximum is retained.
    for(const delay of [80,250,650]){
      const timer=win.setTimeout(()=>{timers.delete(timer);queue();},delay);timers.add(timer);
    }
  };
  const pause=()=>{suspended=true;keyboardSession=false;clearPending();};
  const resume=()=>{suspended=false;keyboardSession=false;settle();};
  const visibility=()=>doc.hidden?pause():resume();
  const focusIn=event=>{keyboardSession=textEditor(event.target);settle();};
  const focusOut=()=>{keyboardSession=false;settle();};
  const bindings=[
    [win,'resize',settle],[win,'orientationchange',settle],[win,'pageshow',resume],[win,'pagehide',pause],
    [win,'focus',resume],[win.visualViewport,'resize',queue],[doc,'visibilitychange',visibility],
    [doc,'focusin',focusIn],[doc,'focusout',focusOut],[doc,'fullscreenchange',settle],
    ...modes.map(mode=>[mode,'change',settle]),
  ];
  for(const [target,event,listener]of bindings)target?.addEventListener(event,listener);
  update();
  return()=>{
    disposed=true;clearPending();
    for(const [target,event,listener]of bindings)target?.removeEventListener(event,listener);
    probe?.remove();root.style.removeProperty('--app-height');
  };
}
