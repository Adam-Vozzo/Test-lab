import {TAU,clamp,lerp,rgba,createSurface,bindPointers,label,line} from './kit.js';

export const definition={
  id:'carrier',name:'Carrier / Modulator',batch:1,
  theme:{bg:'#f0ede5',fg:'#262725',accent:'#ce4939',muted:'#79766e'},
  defaultSound:{waveform:'sine',attack:.025,decay:.25,sustain:.75,release:.75,cutoff:9500,resonance:.6,ratio:2,index:1.8,gain:.28,glide:.055},
  defaultAppearance:{dotSpacing:27,dotSize:1.65,guideOpacity:.25,ribbonWidth:1,ribbonOpacity:.7,tension:8,damping:7,ribbonMotion:.65,coupling:.55,paperGrain:.035,ink:'#262725',paper:'#f0ede5',prismHue:0},
  soundControls:[
    {key:'ratio',label:'Modulator ratio',min:.25,max:12,step:.25,unit:'×',section:'Modulation',description:'Modulator frequency relative to the carrier; also the right radial selection.'},
    {key:'index',label:'Modulation index',min:0,max:12,step:.05,section:'Modulation',description:'FM depth and the width of the coupling traces.'},
    {key:'glide',label:'Pitch glide',min:0,max:.35,step:.005,unit:'s',section:'Pitch',description:'Time for the carrier to move between selected scale notes.'}
  ],
  appearanceControls:[
    {key:'ribbonWidth',label:'Ribbon width',min:.25,max:2,step:.05,section:'Ribbons',description:'Width of the translucent prismatic surfaces.'},
    {key:'ribbonOpacity',label:'Ribbon opacity',min:.1,max:1,step:.01,section:'Ribbons',description:'Transparency of the coloured ribbon material.'},
    {key:'tension',label:'Ribbon tension',min:2,max:20,step:.5,section:'Ribbons',description:'How quickly ribbons follow a moving contact; sound remains immediate.'},
    {key:'damping',label:'Ribbon damping',min:2,max:16,step:.5,section:'Ribbons',description:'How quickly ribbon motion settles after a gesture.'},
    {key:'ribbonMotion',label:'Surface motion',min:0,max:1.5,step:.05,section:'Ribbons',description:'Local ripple movement inside the ribbons.'},
    {key:'prismHue',label:'Prism hue',min:-180,max:180,step:1,unit:'°',section:'Ribbons',description:'Rotates the ribbon spectrum without recolouring the paper or ink.'},
    {key:'coupling',label:'Coupling trace opacity',min:0,max:1,step:.05,section:'Coupling',description:'Visibility of the traces linking carrier and modulation.'},
    {key:'dotSpacing',label:'Dot spacing',min:12,max:42,step:1,unit:'px',section:'Guides',description:'Spacing of the fixed paper dot lattice.'},
    {key:'dotSize',label:'Dot radius',min:.35,max:2,step:.05,unit:'px',section:'Guides',description:'Radius of each paper guide dot.'},
    {key:'guideOpacity',label:'Radial guide opacity',min:0,max:.6,step:.01,section:'Guides',description:'Contrast of degree, ratio and angle guides.'},
    {key:'paperGrain',label:'Paper grain',min:0,max:.35,step:.01,section:'Paper',description:'Fine static fibre texture on the paper.'},
    {key:'paper',label:'Paper colour',kind:'color',section:'Paper',description:'Background colour of the playing surface.'},
    {key:'ink',label:'Ink colour',kind:'color',section:'Paper',description:'Guide dots, contact nodes and technical readouts.'}
  ]
};

const hue=(n,v)=>`hsla(${(n+v.prismHue+360)%360},82%,51%,${v.ribbonOpacity})`;
const origin=(side,w,h)=>({x:w*(side===0?.472:.528),y:h*.64});
export function carrierMapping(nx,ny,side,aspect=1.5){
  const ox=side===0?.472:.528,dx=(nx-ox)*aspect*(side===0?-1:1),dy=.64-ny,radius=Math.min(aspect*.43,.64);
  const radial=clamp(Math.hypot(dx,dy)/radius,0,1),angle=clamp(Math.atan2(dy,Math.max(.005,dx)),-.65,1.25);
  return side===0?{degree:Math.min(6,Math.floor(radial*7)),octave:clamp(Math.floor((angle+.65)/1.9*3)-1,-1,1),radial,angle}
    :{ratio:Math.round((.5+radial*7.5)*4+1e-9)/4,index:Math.round(clamp((angle+.65)/1.9*10,0,10)*20)/20,radial,angle};
}

export function mount(host,api){
  const surface=createSurface(host,{label:'Carrier and modulator. Left: radius selects scale degree, angle selects octave. Right: radius selects modulation ratio, angle selects modulation index.'});
  const c=surface.ctx,contacts=new Map(),cursor=[{nx:.2,ny:.32,x:0,y:0,vx:0,vy:0},{nx:.8,ny:.29,x:0,y:0,vx:0,vy:0}];
  let lastNote=api.quantize(2),lastDegree=2,lastOctave=0,initial=true,grain=null,grainKey='',lastStep=-1,previousW=0,previousH=0;
  const options=()=>({...api.state.sound,ratio:api.state.sound.ratio,index:api.state.sound.index});
  const updateVoices=()=>{api.audio.configure(options());for(const [id,p]of contacts)if(p.ownsVoice&&(!p.released||api.state.hold))api.noteUpdate('carrier-'+id,p.midi,options());};
  function move(p,start=false){
    const hit=contacts.get(p.id);if(!hit)return;
    hit.nx=clamp(p.nx,.025,.975);hit.ny=clamp(p.ny,.07,.9);hit.at=performance.now()/1000;
    const dest=cursor[hit.side];dest.nx=hit.nx;dest.ny=hit.ny;
    const mapped=carrierMapping(hit.nx,hit.ny,hit.side,surface.width/surface.height);
    if(hit.side===0){lastDegree=mapped.degree;lastOctave=mapped.octave;lastNote=api.quantize(lastDegree,lastOctave);hit.midi=lastNote;}
    else{api.setSound({ratio:mapped.ratio,index:mapped.index});hit.midi=lastNote;}
    if(start&&hit.ownsVoice)api.noteOn('carrier-'+p.id,hit.midi,options());
    updateVoices();api.setStatus(`${api.noteName(lastNote)} · ${api.state.sound.ratio.toFixed(2)}× · I ${api.state.sound.index.toFixed(2)}`);api.save();
  }
  const unbind=bindPointers(surface.canvas,{
    down:p=>{const side=p.nx<.5?0:1,hasCarrier=[...contacts.values()].some(q=>q.ownsVoice&&(!q.released||api.state.hold))||api.audio.snapshot().voices.some(q=>q.level>.001);contacts.set(p.id,{side,ownsVoice:side===0||!hasCarrier,nx:p.nx,ny:p.ny,midi:lastNote,released:false,at:performance.now()/1000});move(p,true);},
    move:p=>move(p),
    up:p=>{const q=contacts.get(p.id);if(q){q.released=true;api.noteOff('carrier-'+p.id);}},
    cancel:p=>{contacts.delete(p.id);api.noteOff('carrier-'+p.id);}
  });
  function paper(v,w,h){
    c.fillStyle=v.paper;c.fillRect(0,0,w,h);
    if(v.paperGrain<=0)return;
    const key=v.paperGrain.toFixed(2);if(key!==grainKey){grainKey=key;grain=document.createElement('canvas');grain.width=grain.height=96;const g=grain.getContext('2d'),image=g.createImageData(96,96);let s=42;for(let i=0;i<image.data.length;i+=4){s=(s*1664525+1013904223)>>>0;image.data[i]=image.data[i+1]=image.data[i+2]=s&1?255:0;image.data[i+3]=(s>>>24)*v.paperGrain;}g.putImageData(image,0,0);}
    c.fillStyle=c.createPattern(grain,'repeat');c.fillRect(0,0,w,h);
  }
  function guides(v,w,h){
    const spacing=v.dotSpacing;
    // The guide points belong to the radial geometry on each playing half.
    for(let side=0;side<2;side++){
      const o=origin(side,w,h),radius=Math.min(w*.48,h*.8);c.save();c.beginPath();c.rect(side?w*.5:0,64,w*.5,h-114);c.clip();c.fillStyle=rgba(v.ink,.7);c.beginPath();
      for(let r=spacing;r<radius;r+=spacing){const steps=Math.max(12,Math.round(TAU*r/spacing)),size=v.dotSize*(.55+.65*r/radius);for(let k=0;k<steps;k++){const a=k/steps*TAU,x=o.x+Math.cos(a)*r,y=o.y+Math.sin(a)*r;c.moveTo(x+size,y);c.arc(x,y,size,0,TAU);}}c.fill();c.restore();
    }
    c.strokeStyle=rgba(v.ink,v.guideOpacity);c.lineWidth=.65;
    for(let side=0;side<2;side++){
      const o=origin(side,w,h),radius=Math.min(w*.43,h*.64);c.save();c.beginPath();c.rect(side?w*.5:0,54,w*.5,h-100);c.clip();
      for(let i=1;i<=7;i++){c.beginPath();c.arc(o.x,o.y,radius*i/7,0,TAU);c.stroke();}
      for(let i=0;i<9;i++){const a=-Math.PI*.54+i*Math.PI*.13;const dx=Math.cos(a)*radius*(side?1:-1),dy=Math.sin(a)*radius;line(c,[[o.x,o.y],[o.x+dx,o.y+dy]],rgba(v.ink,v.guideOpacity*.5),.6);}
      c.restore();
      const p=cursor[side],selectedRadius=Math.min(radius,Math.hypot(p.x-o.x,p.y-o.y));c.save();c.beginPath();c.rect(side?w*.5:0,64,w*.5,h-114);c.clip();c.strokeStyle=rgba(v.ink,Math.min(.75,v.guideOpacity*2.3));c.lineWidth=1;c.beginPath();c.arc(o.x,o.y,selectedRadius,0,TAU);c.stroke();c.restore();
    }
    line(c,[[w*.5,25],[w*.5,h-24]],rgba(v.ink,.1),.6);
    for(let i=0;i<7;i++){const x=w*.09+i*w*.052;label(c,String(i+1),x,h-48,rgba(v.ink,i===lastDegree?.85:.34),8,'center');}
  }
  function ribbon(side,v,w,h,t,energy){
    const o=origin(side,w,h),p=cursor[side],dx=p.x-o.x,dy=p.y-o.y,len=Math.max(1,Math.hypot(dx,dy)),normal={x:-dy/len,y:dx/len};
    const width=Math.min(w*.033,h*.056)*v.ribbonWidth;
    const point=(s,edge)=>{
      const impulse=clamp((p.vx*normal.x+p.vy*normal.y)*.02,-40,40);
      const sway=Math.sin(s*Math.PI)*(Math.sin(s*10-t*1.2+side)*v.ribbonMotion*(2+energy*6)-impulse);
      const irregular=.1*Math.sin(s*31+side*3)+.06*Math.sin(s*59+side+t*.25)*Math.sin(s*Math.PI);const spread=(5+width*(1-Math.exp(-s*15))*(.84+.1*Math.sin(s*9+side)+irregular))*edge;
      return {x:o.x+dx*s+normal.x*(spread+sway),y:o.y+dy*s+normal.y*(spread+sway)};
    };
    c.save();
    // Layered, nearly parallel prismatic laminations; the black root blends
    // into the material instead of opening into a triangular fan.
    for(let band=0;band<6;band++)for(let j=0;j<42;j++){
      const edge=-1+band/3,next=-1+(band+1)/3,s=j/42,n=(j+1)/42,a=point(s,edge),b=point(n,edge),d=point(n,next),e=point(s,next);
      const shade=47+band*2.4+Math.sin(j*.55+band)*4,hh=66+s*(side?215:-130)+band*3+v.prismHue;
      c.fillStyle=`hsla(${hh},84%,${shade}%,${v.ribbonOpacity*(.72+.28*Math.sin((band+.5)/6*Math.PI))})`;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.lineTo(d.x,d.y);c.lineTo(e.x,e.y);c.closePath();c.fill();
      if((j+band)%7===0){c.strokeStyle=rgba(v.ink,.06);c.lineWidth=.45;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(e.x,e.y);c.stroke();}
    }
    const rootGradient=c.createLinearGradient(o.x,o.y,o.x+dx*.2,o.y+dy*.2);rootGradient.addColorStop(0,rgba(v.ink,.96));rootGradient.addColorStop(.7,rgba(v.ink,.62));rootGradient.addColorStop(1,rgba(v.ink,0));c.fillStyle=rootGradient;c.beginPath();for(let j=0;j<=20;j++){const a=point(j/100,-1);j?c.lineTo(a.x,a.y):c.moveTo(a.x,a.y);}for(let j=20;j>=0;j--){const a=point(j/100,1);c.lineTo(a.x,a.y);}c.closePath();c.fill();
    for(let j=0;j<11;j++){const s=.08+j*.075,edge=(j%2?1:-1)*(1.27+.16*Math.sin(j)),a=point(s,edge),r=(3.8+Math.sin(j*1.8)*1.7+energy)*v.ribbonWidth;c.fillStyle=hue(66+s*(side?215:-130),v);c.beginPath();c.ellipse(a.x,a.y,r*1.2,r,Math.atan2(dy,dx),0,TAU);c.fill();c.fillStyle=rgba('#ffffff',.45);c.beginPath();c.arc(a.x-r*.25,a.y-r*.25,r*.25,0,TAU);c.fill();}
    c.strokeStyle=rgba(v.ink,.35);c.lineWidth=.7;
    for(const edge of [-1,1]){c.beginPath();for(let i=0;i<=70;i++){const p=point(i/70,edge);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);}c.stroke();}
    for(let j=0;j<4;j++){c.strokeStyle=rgba('#ffffff',.3);c.beginPath();for(let i=0;i<=70;i++){const p=point(i/70,Math.sin(i/9+t*1.4+j)*.3+(j-1.5)*.36);i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);}c.stroke();}
    c.fillStyle=v.ink;c.beginPath();c.ellipse(o.x,o.y,15+energy*3,11+energy*2,Math.atan2(dy,dx),0,TAU);c.fill();
    c.fillStyle='#fff';c.beginPath();c.arc(o.x-3,o.y-3,2.2,0,TAU);c.fill();
    c.strokeStyle=rgba(v.ink,.75);c.lineWidth=1;c.beginPath();c.arc(p.x,p.y,9+energy*3,0,TAU);c.stroke();
    line(c,[[p.x-15,p.y],[p.x-5,p.y]],rgba(v.ink,.7),.8);line(c,[[p.x+5,p.y],[p.x+15,p.y]],rgba(v.ink,.7),.8);
    line(c,[[p.x,p.y-15],[p.x,p.y-5]],rgba(v.ink,.7),.8);line(c,[[p.x,p.y+5],[p.x,p.y+15]],rgba(v.ink,.7),.8);
    // A direction arrow follows the true gesture axis.
    const ax=o.x+dx*.75+normal.x*(width*.9+14),ay=o.y+dy*.75+normal.y*(width*.9+14);
    line(c,[[o.x+dx*.3+normal.x*(width*.6+14),o.y+dy*.3+normal.y*(width*.6+14)],[ax,ay]],rgba(v.ink,.65),1);
    c.beginPath();c.moveTo(ax,ay);c.lineTo(ax-dx/len*9+normal.x*3,ay-dy/len*9+normal.y*3);c.lineTo(ax-dx/len*9-normal.x*3,ay-dy/len*9-normal.y*3);c.fillStyle=v.ink;c.fill();
    c.restore();
  }
  return {
    frame(t,dt){
      if(api.reducedMotion)t=0;
      surface.resize();const w=surface.width,h=surface.height;if(!w||!h)return;
      const v={...definition.defaultAppearance,...api.state.appearance},snap=api.audio.snapshot(),energy=clamp(snap.rms*5,0,1);if(![...contacts.values()].some(p=>!p.released)){const sounding=snap.voices.filter(v=>v.level>.001).sort((a,b)=>b.started-a.started)[0];if(sounding)lastNote=sounding.midi;}paper(v,w,h);guides(v,w,h);
      if(initial){for(const p of cursor){p.x=p.nx*w;p.y=p.ny*h;}initial=false;}else if(previousW&&previousH&&(previousW!==w||previousH!==h)){for(const p of cursor){p.x*=w/previousW;p.y*=h/previousH;p.vx*=w/previousW;p.vy*=h/previousH;}}previousW=w;previousH=h;
      for(const p of cursor){const targetX=p.nx*w,targetY=p.ny*h;p.vx+=(targetX-p.x)*v.tension*v.tension*dt;p.vy+=(targetY-p.y)*v.tension*v.tension*dt;const damp=Math.exp(-v.damping*dt);p.vx*=damp;p.vy*=damp;p.x+=p.vx*dt;p.y+=p.vy*dt;}
      // These curves expose the current FM coupling, rather than a separate clock.
      const l=origin(0,w,h),r=origin(1,w,h);c.save();c.strokeStyle=rgba(v.ink,v.coupling*(.12+energy*.22));c.lineWidth=.65;
      const index=api.state.sound.index,ratio=api.state.sound.ratio;
      for(let k=0;k<7;k++){c.beginPath();for(let j=0;j<=70;j++){const f=j/70,x=l.x-70+f*(r.x-l.x+140),y=l.y+(k-3)*6+Math.sin(f*TAU*ratio+t*2)*Math.sin(f*Math.PI)*(3+index*1.8);j?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();}c.restore();
      ribbon(0,v,w,h,t,energy);ribbon(1,v,w,h,t,energy);
      const small=w<650,sz=small?8:10;
      label(c,'CARRIER',22,24,rgba(v.ink,.55),sz);label(c,api.noteName(lastNote),22,57,v.ink,small?23:32);
      label(c,'MODULATOR',w-22,24,rgba(v.ink,.55),sz,'right');label(c,`${Number(ratio).toFixed(2)}×`,w-22,57,v.ink,small?23:32,'right');
      label(c,`DEG ${lastDegree+1}  OCT ${lastOctave>=0?'+':''}${lastOctave}`,22,h-24,rgba(v.ink,.65),sz);
      label(c,`INDEX ${Number(index).toFixed(2)}`,w-22,h-24,rgba(v.ink,.65),sz,'right');
      label(c,'FM',w*.5,h*.64+43,rgba(v.ink,.42),8,'center');
      const step=snap.step??0;for(let i=0;i<16;i++){const x=w*.38+i*w*.016;c.fillStyle=rgba(v.ink,api.state.playing&&i===step?.75:.16);c.fillRect(x,h-31,3,api.state.playing&&i===step?10:3);}
      for(const [id,p]of contacts)if(p.released&&!api.state.hold&&!snap.voices.some(q=>q.id==='carrier-'+id&&q.level>.001))contacts.delete(id);
    },
    onStep(step,when){lastStep=step;const offsets=[0,2,4,6,4,2,1,3];const midi=api.quantize((lastDegree+offsets[step%8])%7,lastOctave);api.audio.pulse('carrier-step-'+step,midi,options(),when,60/api.state.bpm*.38);},
    update(){updateVoices();},
    cancel(){for(const [id]of contacts)api.noteOff('carrier-'+id);contacts.clear();},
    getData(){return{cursor:cursor.map(p=>({nx:p.nx,ny:p.ny})),degree:lastDegree,octave:lastOctave};},
    setData(data){if(Array.isArray(data?.cursor))for(let i=0;i<2;i++){const p=data.cursor[i];if(Number.isFinite(p?.nx)&&Number.isFinite(p?.ny)){cursor[i].nx=clamp(p.nx,.02,.98);cursor[i].ny=clamp(p.ny,.07,.9);}}if(Number.isInteger(data?.degree))lastDegree=clamp(data.degree,0,6);if(Number.isInteger(data?.octave))lastOctave=clamp(data.octave,-1,1);lastNote=api.quantize(lastDegree,lastOctave);initial=true;},
    destroy(){unbind();for(const [id]of contacts)api.noteOff('carrier-'+id);contacts.clear();surface.destroy();}
  };
}
