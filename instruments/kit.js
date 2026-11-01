export const TAU=Math.PI*2;
export const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:min));
export const lerp=(a,b,t)=>a+(b-a)*t;
export function seeded(seed=42){let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
export function rgba(color,alpha=1){const s=String(color).replace('#','');if(/^[0-9a-f]{6}$/i.test(s))return `rgba(${parseInt(s.slice(0,2),16)},${parseInt(s.slice(2,4),16)},${parseInt(s.slice(4,6),16)},${clamp(alpha)})`;if(/^[0-9a-f]{3}$/i.test(s))return rgba('#'+s.split('').map(c=>c+c).join(''),alpha);return color;}
export function noteName(midi){const n=Math.round(midi);return ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][((n%12)+12)%12]+(Math.floor(n/12)-1);}
export function label(ctx,text,x,y,color='#aaa',size=10,align='left'){ctx.save();ctx.fillStyle=color;ctx.font=`${size}px "SFMono-Regular",Consolas,"Liberation Mono",monospace`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(String(text),x,y);ctx.restore();}
export function line(ctx,points,color='#aaa',width=1){if(!points.length)return;ctx.beginPath();for(let i=0;i<points.length;i++){const p=points[i],x=p.x??p[0],y=p.y??p[1];if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
export function roundedRect(ctx,x,y,w,h,r=3){r=Math.min(Math.abs(w)*.5,Math.abs(h)*.5,r);ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else{ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}}

export function createSurface(host,{label:description='Playable instrument',bg}={}){
  const canvas=document.createElement('canvas');canvas.className='instrument-canvas';canvas.tabIndex=0;canvas.setAttribute('role','application');canvas.setAttribute('aria-label',description);
  canvas.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline-offset:-3px;';
  if(bg)canvas.style.background=bg;host.append(canvas);
  const ctx=canvas.getContext('2d',{alpha:true,desynchronized:true});
  const surface={canvas,ctx,width:1,height:1,dpr:1,resize(){
    const r=canvas.getBoundingClientRect();const w=Math.max(1,r.width),h=Math.max(1,r.height),d=Math.min(window.devicePixelRatio||1,1.75);
    if(Math.round(w*d)!==canvas.width||Math.round(h*d)!==canvas.height||d!==surface.dpr){canvas.width=Math.max(1,Math.round(w*d));canvas.height=Math.max(1,Math.round(h*d));ctx.setTransform(d,0,0,d,0,0);}
    surface.width=w;surface.height=h;surface.dpr=d;return surface;
  },destroy(){observer?.disconnect();canvas.remove();}};
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>surface.resize()):null;
  surface.resize();observer?.observe(canvas);return surface;
}

export function bindPointers(canvas,handlers={}){
  const abort=new AbortController(),events={signal:abort.signal},active=new Map();
  const point=e=>{const r=canvas.getBoundingClientRect();return{id:e.pointerId,x:e.clientX-r.left,y:e.clientY-r.top,nx:clamp((e.clientX-r.left)/r.width),ny:clamp((e.clientY-r.top)/r.height),pressure:e.pressure||.5,event:e};};
  canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;const p=point(e);if(handlers.down?.(p)===false)return;e.preventDefault();active.set(e.pointerId,p);canvas.setPointerCapture?.(e.pointerId);canvas.focus({preventScroll:true});},events);
  canvas.addEventListener('pointermove',e=>{if(!active.has(e.pointerId))return;e.preventDefault();const p=point(e);active.set(e.pointerId,p);handlers.move?.(p);},events);
  const end=(e,cancelled)=>{if(!active.has(e.pointerId))return;e.preventDefault();const p=point(e);active.delete(e.pointerId);if(cancelled)(handlers.cancel||handlers.up)?.(p);else handlers.up?.(p);if(canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);};
  canvas.addEventListener('pointerup',e=>end(e,false),events);canvas.addEventListener('pointercancel',e=>end(e,true),events);canvas.addEventListener('lostpointercapture',e=>end(e,true),events);
  canvas.addEventListener('contextmenu',e=>e.preventDefault(),events);
  return()=>{for(const p of active.values())(handlers.cancel||handlers.up)?.(p);active.clear();abort.abort();};
}
