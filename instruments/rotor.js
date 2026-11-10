import {splitLayout} from '../instrument-layout.js';
import {TAU,clamp,lerp,rgba,seeded,createSurface,bindPointers,label,line} from './kit.js';
import {signalRenderProfile,renderPixelRatio,createFrameGate} from '../render-performance.js';
const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
 id:'rotor',name:'Rotor',commonSoundControls:false,keyboardNotes:true,
 theme:{bg:'#140b09',fg:'#f3e9d4',accent:'#ffc16b',muted:'#9c847b'},
 defaultSound:{waveform:'triangle',attack:.025,decay:.55,sustain:.48,release:1.8,cutoff:5800,resonance:.7,ratio:1.5,index:.45,detune:4,gain:.62,glide:.07,echo:.23,delayTime:.34,feedback:.27,gate:.8,scanRate:'2'},
 defaultAppearance:{amber:'#ffab25',rose:'#ff4eab',cyan:'#4ce9e3',meshFlow:.45,meshSpread:.75,meshBrightness:1,grain:.28,grainSize:1,rotation:.065,ringWidth:.17,ringDetail:.8,guideContrast:.75,response:.7,readoutSize:1},
 soundControls:[
  {key:'waveform',label:'Carrier waveform',kind:'select',options:[['sine','Sine'],['triangle','Triangle'],['wavetable','Wavetable']],section:'Voice',description:'Base tone beneath the harmonic modulation.'},
  range('ratio','Harmonic ratio',.5,6,.25,'Voice','Frequency ratio of the sine modulator to the carrier.','×'),
  range('index','Harmonic depth',0,3,.01,'Voice','Amount of frequency modulation; also follows vertical motion on the spectrum disc.'),
  range('cutoff','Low-pass cutoff',180,14000,20,'Voice','Brightness of the output; also follows horizontal motion on the spectrum disc.','Hz'),
  range('resonance','Filter resonance',.1,6,.1,'Voice','Emphasis around the low-pass cutoff.','Q'),
  range('detune','Detune',0,18,.5,'Voice','Small carrier tuning offset.','ct'),
  range('attack','Attack',.005,.7,.005,'Envelope','Time for a touched sector to reach full level.','s'),
  range('release','Release',.1,4,.05,'Envelope','Time for a released note to fade.','s'),
  range('glide','Pitch glide',0,.3,.005,'Envelope','Retuning time while moving between sectors.','s'),
  range('echo','Delay level',0,.4,.01,'Space','Amount of the repeated signal.'),
  range('delayTime','Delay time',.08,.8,.01,'Space','Spacing between echoes.','s'),
  range('feedback','Delay feedback',0,.55,.01,'Space','Amount returned to the delay.'),
  range('gate','Sequence gate',.15,1.8,.05,'Sequence','Note length relative to the interval.','×'),
  {key:'scanRate',label:'Sequence interval',kind:'select',options:[['1','1/16'],['2','1/8'],['4','1/4']],section:'Sequence',description:'Clock interval for the sixteen memory cells.'}
 ],
 appearanceControls:[
  {key:'amber',label:'Amber field',kind:'color',section:'Gradient mesh',description:'Warm colour at the upper side of each disc.'},
  {key:'rose',label:'Rose field',kind:'color',section:'Gradient mesh',description:'Central pink colour of the moving mesh.'},
  {key:'cyan',label:'Cyan field',kind:'color',section:'Gradient mesh',description:'Cool colour at the lower side of each disc.'},
  range('meshFlow','Mesh movement',0,1,.01,'Gradient mesh','Speed of the smooth colour-field movement. Zero freezes the gradient.'),
  range('meshSpread','Colour mixing',.25,1.3,.05,'Gradient mesh','Width and overlap of the moving colour fields.'),
  range('meshBrightness','Mesh exposure',.3,1.2,.05,'Gradient mesh','Brightness of coloured surfaces. Technical outlines remain independent.','×'),
  range('grain','Surface grain',0,.65,.01,'Surface','Fine monochrome grain blended into the coloured discs using soft light.'),
  range('grainSize','Grain size',.5,2,.1,'Surface','Size of grain pixels, without changing the gradient.','×'),
  range('rotation','Sector rotation',0,.25,.005,'Motion','Slow rotation of the pitch sectors and technical guide arcs. Pitch sectors pause during direct contact.','rad/s'),
  range('response','Audio response',0,1,.05,'Motion','Measured output expands the inner spectrum and brightens contact arcs.'),
  range('ringWidth','Pitch ring width',.1,.25,.01,'Drafting','Radial thickness of the twelve coloured pitch sectors. The full pitch disc remains playable.'),
  range('ringDetail','Guide density',.25,1,.05,'Drafting','Number of calibration ticks and concentric guide marks.'),
  range('guideContrast','Guide contrast',.25,1,.05,'Drafting','Brightness of technical outlines and scales.'),
  range('readoutSize','Readout size',.8,1.3,.05,'Drafting','Size of note and parameter readouts.','×')
 ]
};
export function rotorLayout(width,height,appearance={}){
 const layout=splitLayout(width,height,appearance,{pad:8,gap:18,stackPortrait:true,portraitRatio:.9});
 const disc=r=>({x:r.x+r.w*.5,y:r.y+r.h*.48,r:Math.max(24,Math.min(r.w*.43,(r.h-72)*.48)),rect:r});
 return{...layout,pitch:disc(layout.left),spectrum:disc(layout.right)};
}
export function rotorCoordinates(x,y,disc,phase=0){const dx=x-disc.x,dy=y-disc.y,angle=(Math.atan2(dy,dx)+Math.PI/2-phase+TAU*8)%TAU;return{degree:Math.floor(angle/TAU*12),radius:Math.hypot(dx,dy)/disc.r,nx:clamp(dx/(disc.r*1.7)+.5),ny:clamp(dy/(disc.r*1.7)+.5)};}
const original=[0,4,7,9,2,7,4,11,0,2,9,7,4,11,7,2];
export function mount(host,api){
 const surface=createSurface(host,{label:'Rotor. Touch and drag the coloured pitch sectors to play. The spectrum disc controls cutoff horizontally and harmonic depth vertically. Tap the sixteen memory cells to mute or restore sequence steps.'}),c=surface.ctx,profile=signalRenderProfile(),gate=createFrameGate(profile.mobile?60:90),mesh=document.createElement('canvas'),noise=document.createElement('canvas');
 mesh.width=mesh.height=320;const mc=mesh.getContext('2d');noise.width=noise.height=192;const nc=noise.getContext('2d'),pixels=nc.createImageData(192,192),random=seeded(7721);for(let i=0;i<pixels.data.length;i+=4){const v=Math.floor(random()*256);pixels.data.set([v,v,v,255],i);}nc.putImageData(pixels,0,0);
 surface.resize=()=>{const r=surface.canvas.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height),d=renderPixelRatio(w,h,devicePixelRatio||1,{maxDpr:1.5,maxPixels:profile.mobile?950000:1700000});if(surface.canvas.width!==Math.round(w*d)||surface.canvas.height!==Math.round(h*d)){surface.canvas.width=Math.round(w*d);surface.canvas.height=Math.round(h*d);c.setTransform(d,0,0,d,0,0);}Object.assign(surface,{width:w,height:h,dpr:d});return surface;};surface.resize();
 const contacts=new Map(),muted=Array(16).fill(false);let phase=0,meshPhase=0,time=0,lastTime=0,lastMesh=-1,meshKey='',destroyed=false,sequenceCursor=0,selected=0,lastNote=api.quantize(0),lastStatus='',playing=false,level=0,layout;
 const look=()=>({...definition.defaultAppearance,...api.state.appearance});
 const geometry=()=>layout=rotorLayout(surface.width,surface.height,look());
 function memory(){const r=geometry().left;return{x:r.x+8,y:r.y+r.h-31,w:r.w-16,h:27};}
 function play(p,q,first){const l=geometry(),a=look();let midi=lastNote;
  if(q.kind==='pitch'){const n=rotorCoordinates(p.x,p.y,l.pitch,phase);selected=n.degree;midi=api.quantize(n.degree);q.degree=n.degree;q.radius=n.radius;}
  else{const n=rotorCoordinates(p.x,p.y,l.spectrum);api.setSound({cutoff:180*Math.pow(14000/180,n.nx),index:(1-n.ny)*3});q.nx=n.nx;q.ny=n.ny;}
  lastNote=midi;q.midi=midi;(first?api.noteOn:api.noteUpdate)('rotor-'+p.id,midi,{velocity:q.kind==='pitch'?.66+.2*clamp(p.pressure):.6,pan:q.kind==='pitch'?-.2:.2});
 }
 const unbind=bindPointers(surface.canvas,{
  down(p){const l=geometry(),m=memory();if(p.x>=m.x&&p.x<=m.x+m.w&&p.y>=m.y-4&&p.y<=m.y+m.h){const step=Math.min(15,Math.floor((p.x-m.x)/m.w*16));muted[step]=!muted[step];api.save();return;}
   const a=rotorCoordinates(p.x,p.y,l.pitch,phase),b=rotorCoordinates(p.x,p.y,l.spectrum);const kind=a.radius<=1.08?'pitch':b.radius<=1.08?'spectrum':null;if(!kind)return false;const q={kind};contacts.set(p.id,q);play(p,q,true);},
  move(p){const q=contacts.get(p.id);if(q)play(p,q,false);},
  up(p){if(contacts.has(p.id)){api.noteOff('rotor-'+p.id);contacts.delete(p.id);}api.save();},
  cancel(p){(api.noteCancel||api.noteOff)('rotor-'+p.id);contacts.delete(p.id);}
 });
 function gradient(v,t){const key=[v.amber,v.rose,v.cyan,v.meshSpread,v.meshBrightness].join('|');if(key===meshKey&&t-lastMesh<1/30)return;meshKey=key;lastMesh=t;
  const p=meshPhase;mc.globalCompositeOperation='source-over';mc.fillStyle='#231013';mc.fillRect(0,0,320,320);
  const base=mc.createLinearGradient(0,0,210,320);base.addColorStop(0,v.amber);base.addColorStop(.48,v.rose);base.addColorStop(1,v.cyan);mc.globalAlpha=clamp(v.meshBrightness);mc.fillStyle=base;mc.fillRect(0,0,320,320);
  const fields=[[v.amber,90+Math.sin(p)*85,45+Math.cos(p*.8)*42],[v.rose,220+Math.cos(p*.73)*65,150+Math.sin(p*.62)*100],[v.cyan,120+Math.sin(p*.87+2)*95,275+Math.cos(p*.66)*60]];
  for(const [col,x,y]of fields){const g=mc.createRadialGradient(x,y,0,x,y,155*v.meshSpread);g.addColorStop(0,rgba(col,.85));g.addColorStop(1,rgba(col,0));mc.fillStyle=g;mc.fillRect(0,0,320,320);}mc.globalAlpha=1;
 }
 function coloured(d,v,path){c.save();path();c.clip();c.drawImage(mesh,d.x-d.r,d.y-d.r,d.r*2,d.r*2);if(v.grain>0){c.globalCompositeOperation='soft-light';c.globalAlpha=v.grain;c.imageSmoothingEnabled=false;const size=192*v.grainSize;for(let y=d.y-d.r;y<d.y+d.r;y+=size)for(let x=d.x-d.r;x<d.x+d.r;x+=size)c.drawImage(noise,x,y,size,size);c.imageSmoothingEnabled=true;}c.restore();}
 function arc(d,r,start,end,ink,width=1){c.beginPath();c.arc(d.x,d.y,d.r*r,start,end);c.strokeStyle=ink;c.lineWidth=width;c.stroke();}
 function annulus(d,inner,outer,start,end){c.beginPath();c.arc(d.x,d.y,d.r*outer,start,end);c.arc(d.x,d.y,d.r*inner,end,start,true);c.closePath();}
 function drafting(d,v,spin){const gc=v.guideContrast;arc(d,1.04,0,TAU,rgba('#f5ead9',gc*.56),.7);arc(d,.72,0,TAU,rgba('#f5ead9',gc*.36),.6);for(let k=0;k<4;k++){const angle=k*TAU/4+spin;arc(d,1.085,angle+.06,angle+.9,rgba('#f5ead9',gc*.66),k%2?1:2.8);}
  const ticks=Math.round(60*v.ringDetail);for(let k=0;k<ticks;k++){const t=k/ticks*TAU,r1=d.r*(k%5?1.005:.985),r2=d.r*1.025;line(c,[[d.x+Math.cos(t)*r1,d.y+Math.sin(t)*r1],[d.x+Math.cos(t)*r2,d.y+Math.sin(t)*r2]],rgba('#f3e9d4',gc*(k%5?.48:.9)),.7);}
 }
 function draw(v,snap){const l=geometry(),d=l.pitch,s=l.spectrum,w=surface.width,h=surface.height;c.clearRect(0,0,w,h);c.fillStyle='#140b09';c.fillRect(0,0,w,h);
  const size=Math.max(8,Math.min(11,h*.017))*v.readoutSize;
  for(const [r,title,value]of [[l.left,'PITCH / 12',api.noteName(lastNote)],[l.right,'FM / '+api.state.sound.ratio.toFixed(2)+' : 1',Math.round(api.state.sound.cutoff)+' HZ · I '+api.state.sound.index.toFixed(2)]]){label(c,title,r.x+8,r.y+14,'#d4b7a3',size);label(c,value,r.x+r.w-8,r.y+14,'#f3e9d4',size,'right');line(c,[[r.x+8,r.y+27],[r.x+r.w-8,r.y+27]],'#503129',.7);}
  drafting(d,v,phase*.7);const voices=snap.voices.filter(q=>q.level>.01);const active=new Set(voices.map(q=>q.midi));
  for(let k=0;k<12;k++){const start=-Math.PI/2+phase+k*TAU/12+.018,end=start+TAU/12-.036,hot=active.has(api.quantize(k));coloured(d,v,()=>annulus(d,1-v.ringWidth,1,start,end));if(hot){annulus(d,1-v.ringWidth,1,start,end);c.fillStyle=rgba('#fff5ce',.18+level*.25);c.fill();arc(d,1.015,start,end,'#fff4dd',2.4);}
   const angle=(start+end)/2,r=d.r*(1-v.ringWidth*.5);label(c,String(k+1).padStart(2,'0'),d.x+Math.cos(angle)*r,d.y+Math.sin(angle)*r,'#29151b',Math.max(7,size*.85),'center');
  }
  for(let k=0;k<3;k++){const start=phase*(k%2?-1:1)+k*2.1;arc(d,.59+k*.035,start,start+1.3,rgba('#e7c4a2',v.guideContrast*.45),.7);}
  label(c,api.noteName(lastNote),d.x,d.y-8,'#ffebcd',Math.max(23,d.r*.22)*v.readoutSize,'center');label(c,(440*Math.pow(2,(lastNote-69)/12)).toFixed(1)+' HZ',d.x,d.y+22,'#a6887b',size*.9,'center');
  // Real waveform occupies the core, while key geometry remains unmodulated.
  const wave=snap.waveform;if(wave?.length){c.beginPath();for(let i=0;i<72;i++){const xx=d.x-d.r*.36+i/71*d.r*.72,yy=d.y+d.r*.28+wave[Math.floor(i/71*(wave.length-1))]*d.r*.5*v.response;if(i)c.lineTo(xx,yy);else c.moveTo(xx,yy);}c.strokeStyle=rgba(v.cyan,.55);c.lineWidth=.8;c.stroke();}
  drafting(s,v,-phase*.8);coloured({...s,r:s.r*.76},v,()=>{c.beginPath();c.arc(s.x,s.y,s.r*.76,0,TAU);});
  // Windowed concentric bands and four chamfered nodes echo the reference HUD.
  c.fillStyle='#140b09';c.beginPath();c.arc(s.x,s.y,s.r*.54,0,TAU);c.fill();
  for(let k=0;k<4;k++){const a=k*TAU/4-phase*.5;arc(s,.61,a+.08,a+1.02,rgba('#fff5de',v.guideContrast*.7),1);const x=s.x+Math.cos(a)*s.r*.88,y=s.y+Math.sin(a)*s.r*.88;c.beginPath();c.arc(x,y,Math.max(3,s.r*.035),0,TAU);c.strokeStyle=rgba('#f3e9d4',v.guideContrast*.6);c.lineWidth=.8;c.stroke();line(c,[[x,y],[s.x+Math.cos(a)*s.r*.78,s.y+Math.sin(a)*s.r*.78]],rgba('#f3e9d4',.35),.6);}
  // Chamfered circuit routes occupy the outer collar. Their gaps and collars
  // remain geometric, rather than a second filled circle competing with colour.
  for(let k=0;k<8;k++){
   const a=k*TAU/8-phase*.22,polar=(r,t)=>[s.x+Math.cos(t)*s.r*r,s.y+Math.sin(t)*s.r*r];
   const points=[polar(.79,a+.09),polar(.82,a+.13),polar(.94,a+.13),polar(.98,a+.17),polar(.98,a+.58),polar(.94,a+.62),polar(.82,a+.62),polar(.79,a+.66)];
   line(c,points,rgba('#e5c4b2',v.guideContrast*.72),.65);
   const tip=polar(.88,a+.375);c.fillStyle=rgba(v.cyan,.45+level*.3);c.fillRect(tip[0]-1.2,tip[1]-1.2,2.4,2.4);
   if(k%2===0){const p=polar(.88,a+.31),q=polar(.88,a+.44);line(c,[p,q],rgba('#e5c4b2',.46),.6);}
  }
  for(let k=0;k<32;k++){const angle=k/32*TAU+phase*.3,power=snap.frequency?.[Math.min(255,k*5)]||0,r1=.78,r2=r1+.035+power*.09*v.response;line(c,[[s.x+Math.cos(angle)*s.r*r1,s.y+Math.sin(angle)*s.r*r1],[s.x+Math.cos(angle)*s.r*r2,s.y+Math.sin(angle)*s.r*r2]],rgba('#f3d4b8',.18+power*.45),.7);}
  const cx=clamp(Math.log(api.state.sound.cutoff/180)/Math.log(14000/180)),cy=1-api.state.sound.index/3,px=s.x+(cx-.5)*s.r*.68,py=s.y+(cy-.5)*s.r*.68;
  line(c,[[s.x-s.r*.42,s.y],[s.x+s.r*.42,s.y]],'#624548',.7);line(c,[[s.x,s.y-s.r*.42],[s.x,s.y+s.r*.42]],'#624548',.7);
  const bloom=1+level*v.response*.12;arc(s,.40*bloom,0,TAU,rgba(v.cyan,.4+level*.5),.8);
  c.strokeStyle='#fff0d9';c.lineWidth=1;c.strokeRect(px-5,py-5,10,10);line(c,[[px-9,py],[px+9,py]],'#fff0d9',.7);line(c,[[px,py-9],[px,py+9]],'#fff0d9',.7);
  const newest=snap.voices.filter(q=>q.id.startsWith('rotor-seq-')&&q.level>.002).sort((a,b)=>b.started-a.started)[0],m=memory(),step=playing&&newest?Number(newest.id.split('-').at(-1)):-1;for(let i=0;i<16;i++){const cell=m.w/16,x=m.x+i*cell;c.fillStyle=rgba(v.rose,muted[i]?.015:step===i?.65:.12);c.fillRect(x+2,m.y+2,cell-4,m.h-4);c.strokeStyle=rgba('#e7c4a2',step===i?.8:.25);c.lineWidth=.65;c.strokeRect(x+2,m.y+2,cell-4,m.h-4);label(c,muted[i]?'·':String(original[i]+1).padStart(2,'0'),x+cell*.5,m.y+m.h*.5,muted[i]?'#725b55':'#d9c3b2',Math.max(6.5,size*.72),'center');}
  label(c,'X  CUTOFF     Y  HARMONICS',l.right.x+l.right.w*.5,l.right.y+l.right.h-18,'#b99a91',size*.9,'center');
 }
 return{
  frame(t,dt){if(destroyed||!gate.due(t*1000))return;dt=Math.min(.1,lastTime?t-lastTime:dt);time=t;lastTime=t;surface.resize();const v=look(),snap=api.audio.snapshot();if(!api.reducedMotion)meshPhase+=dt*v.meshFlow*.18;if(!api.reducedMotion&&![...contacts.values()].some(q=>q.kind==='pitch'))phase=(phase+dt*v.rotation)%TAU;const target=clamp(snap.rms*9);level+=(target-level)*(1-Math.exp(-dt*12));const audible=snap.voices.filter(q=>q.level>.005).sort((a,b)=>b.started-a.started)[0];if(audible)lastNote=audible.midi;gradient(v,t);draw(v,snap);const status=api.noteName(lastNote);if(status!==lastStatus){api.setStatus(status);lastStatus=status;}},
  onStep(step,when){const interval=Number(api.state.sound.scanRate)||2;if(step%interval)return;const index=sequenceCursor++%16;if(muted[index])return;const degree=original[index],midi=api.quantize(degree);api.audio.pulse('rotor-seq-'+index,midi,{...api.state.sound,velocity:index%4===0?.78:.6,pan:Math.sin(index*.8)*.35},when,60/api.state.bpm/4*interval*api.state.sound.gate);},
  setPlaying(value){if(value&&!playing)sequenceCursor=0;playing=Boolean(value);},
  getData(){return{phase,meshPhase,muted:[...muted]};},setData(data){if(Number.isFinite(data?.meshPhase))meshPhase=data.meshPhase%TAU;if(Number.isFinite(data?.phase))phase=((data.phase%TAU)+TAU)%TAU;if(Array.isArray(data?.muted))for(let i=0;i<16;i++)muted[i]=Boolean(data.muted[i]);},
  cancel(){for(const id of contacts.keys())(api.noteCancel||api.noteOff)('rotor-'+id);contacts.clear();},
  destroy(){destroyed=true;unbind();for(const id of contacts.keys())(api.noteCancel||api.noteOff)('rotor-'+id);contacts.clear();surface.destroy();mesh.width=mesh.height=noise.width=noise.height=0;}
 };
}
