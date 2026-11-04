/** Track the visible viewport, including installed WebKit orientation changes.
 * CSS dvh is retained as the no-JavaScript fallback. Browser pinch zoom does not
 * resize the instrument or move its playing targets underneath a held finger. */
export function installViewportFit(win=window,root=document.documentElement){
  let frame=0,last=0,disposed=false;
  const update=()=>{
    frame=0;if(disposed)return;
    const visual=win.visualViewport;
    if(visual&&Math.abs((visual.scale||1)-1)>.01)return;
    const height=Math.round(visual?.height||win.innerHeight||root.clientHeight);
    if(height>0&&height!==last){last=height;root.style.setProperty('--app-height',height+'px');}
  };
  const queue=()=>{if(!frame&&!disposed)frame=win.requestAnimationFrame(update);};
  const bindings=[[win,'resize'],[win,'orientationchange'],[win,'pageshow'],[win.visualViewport,'resize']];
  for(const [target,event]of bindings)target?.addEventListener(event,queue);
  update();
  return()=>{disposed=true;if(frame)win.cancelAnimationFrame(frame);for(const [target,event]of bindings)target?.removeEventListener(event,queue);root.style.removeProperty('--app-height');};
}
