import {TAU,clamp,lerp,rgba,createSurface,bindPointers,label,line,roundedRect} from './kit.js';
import {RelayRenderer} from './relay-renderer.js';
import {relayModes} from '../relay-voice.js';
import {signalRenderProfile,renderPixelRatio,createFrameGate} from '../render-performance.js';

const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
  id:'relay',name:'Relay / Resonator',layoutMode:'single',commonSoundControls:false,keyboardNotes:true,
  theme:{bg:'#080a0b',fg:'#c6ced1',accent:'#ff754b',muted:'#748086'},
  defaultSound:{waveform:'resonator',material:.32,damping:.38,brightness:.58,strike:.28,excitation:.22,attack:.006,decay:1.5,sustain:.65,release:1.8,gain:.78,cutoff:10000,resonance:.7,echo:.18,feedback:.28,delayTime:.31,glide:.045,detune:0,pan:0,gate:.6},
  defaultAppearance:{signalColour:'#ff754b',wireColour:'#8ca0ae',tineWidth:.72,metalLight:.8,metalRoughness:.24,iridescence:.55,chamberScale:1,wireContrast:.5,traceContrast:.7,traceWidth:1,packetSize:2,packetSpeed:.65,vibration:1,idleMotion:.5,gridContrast:.16,readoutContrast:.95,spectrumHeight:.65,sceneGrain:.035},
  soundControls:[
    range('material','Material',0,1,.01,'Resonator','Spacing of the six resonant modes. Low values are string-like; high values become metallic. Also controlled horizontally in the chamber.'),
    range('damping','Damping',0,1,.01,'Resonator','Decay of the upper resonant modes. Higher values shorten and soften the ringing. Also controlled vertically in the chamber.'),
    range('brightness','Brightness',0,1,.01,'Excitation','Balance of the upper resonant modes; also the first physical dial.'),
    range('strike','Strike position',0,1,.01,'Excitation','Where the reed is excited. Changes the harmonic balance. Touch height on the reed overrides this for that note.'),
    range('excitation','Sustain energy',0,1,.01,'Excitation','Continuous energy supplied while a note is touched or held. Low values behave like a pluck; high values become bowed.'),
    range('attack','Attack',.002,.5,.002,'Envelope','Time for the resonator to reach its initial level.','s'),
    range('decay','Envelope decay',.1,4,.01,'Envelope','Time for the whole voice to move from its attack peak to the sustain level.','s'),
    range('sustain','Sustain level',0,1,.01,'Envelope','Level retained by a touched or held note after its initial decay.'),
    range('release','Release',.05,6,.01,'Envelope','Time for the resonator to fade after a finger lifts.','s'),
    range('cutoff','Output low-pass',400,18000,10,'Output','Cuts high frequencies after the resonator.','Hz'),
    range('echo','Delay level',0,.45,.01,'Output','Level of repeated resonance after the dry signal.'),
    range('delayTime','Delay time',.08,.8,.01,'Output','Time between repeats.','s'),
    range('feedback','Delay feedback',0,.65,.01,'Output','Amount returned to the delay, controlling the tail length.'),
    range('gate','Sequence gate',.15,1.8,.01,'Sequence','Length of each sequenced note relative to one sixteenth-note step.','×')
  ],
  appearanceControls:[
    range('tineWidth','Reed width',.3,.95,.01,'Reed bank','Width of the eight playable metal reeds; their touch targets stay the same.'),
    range('vibration','Reed displacement',0,2,.05,'Reed bank','Amount of visible bending when a reed sounds. Does not change the sound.'),
    range('metalLight','Metal reflections',.15,1.5,.05,'Metal chamber','Brightness of the metal reflections on the reeds and folded resonator.'),
    range('metalRoughness','Metal roughness',.08,.7,.01,'Metal chamber','Sharpness of reflections on the three-dimensional folded reeds.'),
    range('iridescence','Edge iridescence',0,1,.01,'Metal chamber','Strength of the thin-film colour visible at the metal edges.'),
    range('chamberScale','Resonator scale',.6,1.18,.01,'Metal chamber','Size of the folded metal structure within its touch surface.'),
    range('wireContrast','Contour contrast',0,1,.01,'Metal chamber','Visibility of the fine contour lines on the folded resonator.'),
    {key:'wireColour',label:'Contour colour',kind:'color',section:'Metal chamber',description:'Colour of metal outlines, calibration guides and fine construction marks.'},
    range('idleMotion','Idle movement',0,1.5,.05,'Metal chamber','Slow movement of the suspended resonator when no notes are sounding.'),
    {key:'signalColour',label:'Signal colour',kind:'color',section:'Signal paths',description:'Colour of sounding reeds, moving circuit packets and sequence contacts.'},
    range('traceContrast','Circuit contrast',0,1,.01,'Signal paths','Visibility of the fixed paths connecting each reed to the chamber.'),
    range('traceWidth','Circuit width',.5,2,.05,'Signal paths','Stroke width of the signal paths.','px'),
    range('packetSize','Packet size',.5,4,.1,'Signal paths','Size of the moving signal markers.','px'),
    range('packetSpeed','Packet speed',.15,1.5,.05,'Signal paths','Travel speed along the circuit paths, multiplied by the tempo.','×'),
    range('gridContrast','Calibration grid',0,.5,.01,'Readouts','Contrast of the fine crosshair grid beneath the mechanism.'),
    range('readoutContrast','Readout contrast',.4,1,.01,'Readouts','Brightness of functional labels, note values and scale markings.'),
    range('spectrumHeight','Spectrum height',.2,1,.01,'Readouts','Height of the measured output spectrum beside the chamber.')
  ]
};

export const RELAY_PATTERN=Object.freeze([0,4,2,7,0,5,4,2,3,7,5,4,2,6,4,1]);
export function relayLayout(width,height){
  const w=Math.max(1,width),h=Math.max(1,height),pad=Math.max(10,Math.min(25,w*.023)),portrait=w<h*.95;
  const head=Math.min(36,h*.105),bottom=portrait?50:69;
  let bank,chamber,sequence,dials;
  if(!portrait){bank={x:pad,y:head,w:(w-pad*2)*.44,h:Math.max(50,h-head-bottom-12)};chamber={x:w*.52,y:head,w:w*.46-pad,h:Math.max(50,h-head-bottom-12)};sequence={x:pad+12,y:h-57,w:bank.w-24,h:33};dials=Array.from({length:3},(_,i)=>({x:chamber.x+chamber.w*(.19+i*.31),y:h-38,r:16}));}
  else{bank={x:pad,y:head,w:w-pad*2,h:Math.max(90,(h-head-bottom)*.43)};chamber={x:pad,y:bank.y+bank.h+25,w:w-pad*2,h:Math.max(100,(h-head-bottom)*.46-30)};sequence={x:pad+6,y:h-42,w:w-pad*2-12,h:29};dials=Array.from({length:3},(_,i)=>({x:pad+(w-pad*2)*(.18+i*.32),y:Math.min(h-103,chamber.y+chamber.h+31),r:14}));}
  const tines=Array.from({length:8},(_,i)=>({x:bank.x+bank.w*(.11+i*.105),y:bank.y+bank.h*(.13+Math.sin(i*.34)*.105),w:bank.w*.073,h:bank.h*(.66-Math.sin(i*.34)*.105),index:i}));
  const hero={x:chamber.x-chamber.w*.04,y:chamber.y+(portrait?9:6),w:chamber.w*.9,h:Math.max(30,chamber.h-(portrait?37:10))};
  return{w,h,pad,portrait,bank,chamber,sequence,dials,tines,hero};
}
const contains=(r,x,y)=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;
export function relayHit(x,y,l){
  for(let i=0;i<3;i++){const d=l.dials[i];if(Math.abs(x-d.x)<Math.max(23,l.chamber.w*.12)&&Math.abs(y-d.y)<28)return{kind:'dial',index:i};}
  if(contains({x:l.sequence.x,y:l.sequence.y-9,w:l.sequence.w,h:l.sequence.h+18},x,y))return{kind:'step',index:Math.min(15,Math.floor(clamp((x-l.sequence.x)/l.sequence.w)*16))};
  if(contains(l.bank,x,y)){const index=clamp(Math.round(((x-l.bank.x)/l.bank.w-.11)/.105),0,7);return{kind:'reed',index};}
  if(contains(l.chamber,x,y))return{kind:'chamber',index:0};return null;
}
export function relayNote(index,scale='dorian'){const length=scale==='chromatic'?12:scale==='pentatonic'?5:7;return Math.round(clamp(index,0,7)*length/7);}

const DIALS=[['brightness','BRIGHTNESS'],['strike','STRIKE'],['excitation','ENERGY']];
function screw(c,x,y,r=3.3){const g=c.createRadialGradient(x-r*.4,y-r*.4,.1,x,y,r);g.addColorStop(0,'#6e777c');g.addColorStop(.45,'#30383e');g.addColorStop(.8,'#11161a');g.addColorStop(1,'#8c969c');c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,TAU);c.fill();line(c,[[x-r*.5,y+r*.3],[x+r*.5,y-r*.3]],'#05090c',1);}
function corners(c,r,colour){c.strokeStyle=colour;c.lineWidth=.6;const z=8;for(const [x,y,sx,sy] of [[r.x,r.y,1,1],[r.x+r.w,r.y,-1,1],[r.x,r.y+r.h,1,-1],[r.x+r.w,r.y+r.h,-1,-1]]){c.beginPath();c.moveTo(x+z*sx,y);c.lineTo(x,y);c.lineTo(x,y+z*sy);c.stroke();}}
function tracePoints(start,end,index,portrait){
  if(portrait){const bend=start.y+16+index*3;return[start,{x:start.x,y:bend},{x:end.x-20-index*4,y:bend},{x:end.x-20-index*4,y:end.y},{x:end.x,y:end.y}];}
  const bridge=start.x+30+index*6;return[start,{x:bridge,y:start.y},{x:bridge,y:end.y+24+index*5},{x:end.x-24,y:end.y+24+index*5},{x:end.x-24,y:end.y},{x:end.x,y:end.y}];
}
function trace(c,points,colour,width){c.strokeStyle=colour;c.lineWidth=width;c.lineJoin='round';c.beginPath();for(let i=0;i<points.length;i++){const p=points[i];if(i===0)c.moveTo(p.x,p.y);else if(i<points.length-1){const prev=points[i-1],next=points[i+1],a=Math.min(9,Math.hypot(p.x-prev.x,p.y-prev.y)*.4),b=Math.min(9,Math.hypot(next.x-p.x,next.y-p.y)*.4),d=Math.hypot(p.x-prev.x,p.y-prev.y)||1,e=Math.hypot(next.x-p.x,next.y-p.y)||1;c.lineTo(p.x-(p.x-prev.x)/d*a,p.y-(p.y-prev.y)/d*a);c.quadraticCurveTo(p.x,p.y,p.x+(next.x-p.x)/e*b,p.y+(next.y-p.y)/e*b);}else c.lineTo(p.x,p.y);}c.stroke();c.lineJoin='miter';}
function pathPoint(points,f){const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i].x,p.y-points[i].y)),total=lengths.reduce((a,b)=>a+b,0);let d=f*total;for(let i=0;i<lengths.length;i++){if(d<=lengths[i]||i===lengths.length-1){const t=d/(lengths[i]||1);return{x:lerp(points[i].x,points[i+1].x,t),y:lerp(points[i].y,points[i+1].y,t)};}d-=lengths[i];}return points[0];}

export function mount(host,api){
  const surface=createSurface(host,{label:'Relay resonator background'}),c=surface.ctx;surface.canvas.removeAttribute('tabindex');surface.canvas.setAttribute('aria-hidden','true');surface.canvas.style.pointerEvents='none';
  const metal=new RelayRenderer(host);
  const overlay=createSurface(host,{label:'Relay resonator. Touch or slide across the eight reeds to play. Drag the chamber horizontally for material and vertically for damping. Drag a sequence contact vertically to change its pitch; tap to mute or enable it. Brightness, strike and energy dials sit below the chamber.'}),ui=overlay.ctx;
  overlay.canvas.style.cssText+='position:absolute;inset:0;z-index:2;';
  const profile=signalRenderProfile(),frameGate=createFrameGate(profile.mobile?60:90);
  for(const [layer,budget]of [[surface,900000],[overlay,1400000]]){layer.resize=()=>{const rect=layer.canvas.getBoundingClientRect(),w=Math.max(1,rect.width),h=Math.max(1,rect.height),d=renderPixelRatio(w,h,window.devicePixelRatio||1,{maxDpr:1.6,maxPixels:profile.mobile?budget:2200000});if(layer.canvas.width!==Math.round(w*d)||layer.canvas.height!==Math.round(h*d)||layer.dpr!==d){layer.canvas.width=Math.max(1,Math.round(w*d));layer.canvas.height=Math.max(1,Math.round(h*d));layer.ctx.setTransform(d,0,0,d,0,0);}layer.width=w;layer.height=h;layer.dpr=d;return layer;};layer.resize();}
  const contacts=new Map(),owned=new Set(),energy=Array(8).fill(0),launches=Array(8).fill(-Infinity),packets=Array.from({length:8},()=>[]),lastFlow=Array(8).fill(-Infinity),pattern=[...RELAY_PATTERN],enabled=Array(16).fill(true);
  let layout=relayLayout(surface.width,surface.height),time=0,lastAudioTime=0,lastDegree=0,latestNote=api.quantize(0),lastStatus='',destroyed=false;
  const getLayout=()=>layout=relayLayout(surface.width,surface.height);
  const cancelNote=id=>{(api.noteCancel||api.noteOff)('relay-'+id);owned.delete(id);};
  function updateNote(p,contact,first=false){
    const l=getLayout();let degree=first?lastDegree:(contact.degree??lastDegree),options={velocity:.82},restrike=false;
    if(contact.kind==='reed'){
      const nextIndex=clamp(Math.round(((p.x-l.bank.x)/l.bank.w-.11)/.105),0,7);restrike=!first&&nextIndex!==contact.index;contact.index=nextIndex;degree=relayNote(contact.index,api.state.scale);lastDegree=degree;
      const tine=l.tines[contact.index];options={strike:clamp((p.y-tine.y)/Math.max(1,tine.h),.05,.95),velocity:.82,pan:(contact.index/7-.5)*.45};contact.strike=options.strike;
    }else if(contact.kind==='chamber'){
      const material=clamp((p.x-l.chamber.x)/l.chamber.w),damping=clamp((p.y-l.chamber.y)/l.chamber.h);api.setSound({material,damping});contact.x=p.x;contact.y=p.y;options={velocity:.8};
    }else if(contact.kind==='step'){
      if(!first){const delta=Math.round((contact.startY-p.y)/Math.max(6,l.bank.h*.06));pattern[contact.index]=clamp(contact.startDegree+delta,-7,21);contact.moved ||= Math.abs(p.y-contact.startY)>5;enabled[contact.index]=true;}
      degree=pattern[contact.index];lastDegree=degree;options={velocity:.72};
    }
    latestNote=api.quantize(degree);contact.degree=degree;contact.midi=latestNote;
    (first||restrike?api.noteOn:api.noteUpdate)('relay-'+p.id,latestNote,options);owned.add(p.id);
    const reed=Math.round(clamp(degree/Math.max(1,relayNote(7,api.state.scale)))*7);energy[reed]=Math.max(energy[reed],.35);
  }
  const unbind=bindPointers(overlay.canvas,{
    down(p){getLayout();const hit=relayHit(p.x,p.y,layout);if(!hit)return false;const contact={...hit,id:p.id,startY:p.y,startX:p.x,startDegree:pattern[hit.index]??0,moved:false};contacts.set(p.id,contact);
      if(hit.kind==='dial'){contact.startValue=api.state.sound[DIALS[hit.index][0]];return;}
      updateNote(p,contact,true);
    },
    move(p){const q=contacts.get(p.id);if(!q)return;if(q.kind==='dial'){const value=clamp(q.startValue+(q.startY-p.y)/145+(p.x-q.startX)/240);api.setSound({[DIALS[q.index][0]]:value});}else updateNote(p,q);},
    up(p){const q=contacts.get(p.id);if(!q)return;if(q.kind!=='dial'){api.noteOff('relay-'+p.id);if(!api.state.hold)owned.delete(p.id);if(q.kind==='step'&&!q.moved)enabled[q.index]=!enabled[q.index];}contacts.delete(p.id);api.save();},
    cancel(p){cancelNote(p.id);contacts.delete(p.id);}
  });
  function background(v,l){
    c.clearRect(0,0,l.w,l.h);const bg=c.createLinearGradient(0,0,l.w,l.h);bg.addColorStop(0,'#0b0e10');bg.addColorStop(.54,'#080a0c');bg.addColorStop(1,'#0b0d0e');c.fillStyle=bg;c.fillRect(0,0,l.w,l.h);
    c.strokeStyle=rgba(v.wireColour,v.gridContrast*.37);c.lineWidth=.65;const spacing=l.w<600?26:31;
    for(let x=l.pad+8;x<l.w-l.pad;x+=spacing)for(let y=50;y<l.h-60;y+=spacing){c.beginPath();c.moveTo(x-1.5,y);c.lineTo(x+1.5,y);c.moveTo(x,y-1.5);c.lineTo(x,y+1.5);c.stroke();}
    line(c,[[l.pad,29],[l.w-l.pad,29]],rgba(v.wireColour,.14),.65);
  }
  function bank(v,l,t){
    const b=l.bank,baseY=b.y+b.h*.81;
    // A smoked cover and its fine silver lip reveal the mechanism below.
    const glass=c.createLinearGradient(b.x,b.y,b.x+b.w,b.y+b.h);glass.addColorStop(0,'rgba(65,78,88,.07)');glass.addColorStop(.35,'rgba(5,8,11,.02)');glass.addColorStop(1,'rgba(21,28,34,.16)');c.fillStyle=glass;roundedRect(c,b.x+2,b.y+7,b.w-4,b.h-5,6);c.fill();c.strokeStyle=rgba(v.wireColour,.17);c.lineWidth=.7;c.stroke();
    line(c,[[b.x+10,baseY+9],[b.x+b.w-10,baseY+9]],'#526069',1.1);line(c,[[b.x+10,baseY+11],[b.x+b.w-10,baseY+11]],'#11181d',5);
    for(let i=0;i<8;i++){
      const r=l.tines[i],e=energy[i],mid=r.x+r.w*.5,width=r.w*v.tineWidth,wobble=Math.sin(t*(10.5+i*.53)+i*1.71)*e*6*v.vibration,x=mid-width*.5,y=r.y,bottom=r.y+r.h;
      const g=c.createLinearGradient(x,y,x+width,y);g.addColorStop(0,'#0d151c');g.addColorStop(.08,'#66747e');g.addColorStop(.17,'#202b34');g.addColorStop(.37,'#73818a');g.addColorStop(.52,'#b2bec4');g.addColorStop(.58,'#53616a');g.addColorStop(.86,'#111922');g.addColorStop(1,'#4a5965');
      c.save();c.globalAlpha=.6+v.metalLight*.27;c.fillStyle=g;c.beginPath();c.moveTo(x,bottom);c.bezierCurveTo(x+wobble,bottom-r.h*.25,x+wobble*1.8,y+12,x+width*.22+wobble,y);c.quadraticCurveTo(mid+wobble,y-5,x+width*.78+wobble,y);c.bezierCurveTo(x+width+wobble*1.8,y+12,x+width+wobble,bottom-r.h*.25,x+width,bottom);c.closePath();c.fill();
      c.strokeStyle=rgba(v.wireColour,.42);c.lineWidth=.6;c.stroke();
      const edge=c.createLinearGradient(x,y,x,bottom);edge.addColorStop(0,`rgba(115,158,210,${.7*v.iridescence})`);edge.addColorStop(.36,`rgba(140,123,186,${.3*v.iridescence})`);edge.addColorStop(.72,`rgba(89,130,136,${.35*v.iridescence})`);edge.addColorStop(1,'rgba(10,20,30,0)');c.strokeStyle=edge;c.lineWidth=1.4;c.beginPath();c.moveTo(x+width*.24+wobble,y+3);c.bezierCurveTo(x+wobble*1.8,y+18,x+wobble,bottom-r.h*.2,x+1,bottom-4);c.stroke();c.restore();
      c.fillStyle='#131b20';roundedRect(c,mid-width*.7,bottom-9,width*1.4,15,2);c.fill();c.strokeStyle='#3c474f';c.lineWidth=.7;c.stroke();screw(c,mid,bottom-1,Math.min(3,width*.14));
      if(e>.006){c.save();c.shadowColor=v.signalColour;c.shadowBlur=9*e;c.strokeStyle=rgba(v.signalColour,clamp(e*.85));c.lineWidth=1.4;c.beginPath();c.moveTo(mid+wobble,y+5);c.bezierCurveTo(mid+wobble*2,y+r.h*.35,mid+wobble,bottom-30,mid,bottom-12);c.stroke();c.shadowBlur=0;c.fillStyle=rgba(v.signalColour,e);c.fillRect(mid-2,bottom+17,4,3);c.restore();}
      label(ui,String(i+1).padStart(2,'0'),mid,y-16,rgba(v.wireColour,v.readoutContrast*.82),l.w<700?9:10,'center');label(ui,api.noteName(api.quantize(relayNote(i,api.state.scale))),mid,bottom+29,rgba(e>.06?v.signalColour:'#c6ced1',v.readoutContrast),l.w<700?10:11,'center');
    }
    if(b.h>300){
      const plot={x:b.x+25,y:b.y+b.h*.84+24,w:b.w-50,h:Math.max(15,b.h*.12-19)},modes=relayModes(api.state.sound);
      label(ui,'MODAL DECAY / 4 s',plot.x,plot.y-9,rgba(v.wireColour,v.readoutContrast*.8),9);
      for(let mode=0;mode<6;mode++){const spec=modes[mode],pts=[];for(let j=0;j<=48;j++){const u=j/48,amplitude=spec.weight*(spec.tail+(1-spec.tail)*Math.exp(-u*4/spec.decay));pts.push([plot.x+u*plot.w,plot.y+plot.h-amplitude*plot.h*2.5]);}line(c,pts,rgba(mode<2?v.signalColour:v.wireColour,.19+spec.weight*.85),.75);}
      line(c,[[plot.x,plot.y+plot.h],[plot.x+plot.w,plot.y+plot.h]],rgba(v.wireColour,.2),.65);
    }
    for(const x of [b.x+10,b.x+b.w-10])for(const y of [b.y+15,b.y+b.h-10])screw(c,x,y,2.9);
  }
  function circuits(v,l,t,reduced){
    const chamber=l.chamber,end={x:chamber.x+chamber.w*.38,y:chamber.y+chamber.h*.53};
    for(let i=0;i<8;i++){const r=l.tines[i],start={x:r.x+r.w*.5,y:r.y+r.h+5},pts=tracePoints(start,end,i,l.portrait),e=energy[i];
      trace(c,pts,rgba(v.signalColour,v.traceContrast*(.3+e*.5)),v.traceWidth);
      if(e>.018)trace(c,pts,rgba(v.signalColour,e*.22),v.traceWidth+.6);
      for(const packet of packets[i]){if(packet.progress>=1)continue;const f=reduced?.5:packet.progress,p=pathPoint(pts,f);c.fillStyle=rgba(v.signalColour,packet.strength*(1-f*.15));c.fillRect(p.x-v.packetSize*.5,p.y-v.packetSize*.5,v.packetSize,v.packetSize);}

    }
    c.strokeStyle=rgba(v.signalColour,.42);c.lineWidth=.7;c.beginPath();c.arc(end.x,end.y,5,0,TAU);c.stroke();c.beginPath();c.arc(end.x,end.y,2,0,TAU);c.stroke();
  }
  function fallback(v,l,t,activity){
    const r=l.hero,cx=r.x+r.w*.5,cy=r.y+r.h*.51,s=Math.min(r.w*.52,r.h*.54)*v.chamberScale;
    for(let k=5;k>=0;k--){const pts=[];for(let i=0;i<=80;i++){const u=i/80,a=(u-.5)*TAU*1.12,offset=(k-2.5)*s*.11;pts.push({x:cx+Math.sin(a)*s*.3+offset+Math.sin(t*6+u*9+k)*activity*s*.015,y:cy+(u-.5)*s*1.6});}
      const g=c.createLinearGradient(cx-s*.5,cy-s*.6,cx+s*.4,cy+s*.5);g.addColorStop(0,'#8095a4');g.addColorStop(.18,'#1e2c39');g.addColorStop(.33,'#acb4bc');g.addColorStop(.48,'#273647');g.addColorStop(.7,'#667682');g.addColorStop(.85,'#131f2b');g.addColorStop(1,'#829b9d');line(c,pts,g,Math.max(5,s*.09));line(c,pts,rgba(v.wireColour,v.wireContrast*.45),.7);
    }
  }
  function chamber(v,l,snap){
    const r=l.chamber,fg=rgba('#c6ced1',v.readoutContrast),muted=rgba(v.wireColour,v.readoutContrast*.64);
    corners(c,{x:r.x+6,y:r.y+8,w:r.w-12,h:r.h-13},rgba(v.wireColour,.22));
    const cx=r.x+r.w*.89,top=r.y+r.h*.18,row=Math.max(18,Math.min(42,r.h*.105)),modes=relayModes(api.state.sound);
    label(ui,'MODES',cx,r.y+16,muted,9,'center');
    for(let i=0;i<6;i++){const y=top+i*row,m=modes[i];label(ui,m.ratio.toFixed(2)+'×',cx,y,fg,9,'center');c.fillStyle=rgba(v.wireColour,.13);c.fillRect(cx-20,y+8,40,2);c.fillStyle=rgba(v.signalColour,.7);c.fillRect(cx-20,y+8,40*clamp(m.weight*3),2);}
    const db=snap.rms>0?Math.max(-60,20*Math.log10(snap.rms)):-60,by=Math.min(r.y+r.h-38,top+row*6+8);
    label(ui,(db<=-60?'−∞':db.toFixed(0))+' dB',cx,by,fg,9,'center');
    const sx=r.x+r.w*.1,sy=r.y+r.h-45,sw=r.w*.61,sh=Math.max(8,Math.min(23,r.h*.075))*v.spectrumHeight;
    for(let i=0;i<48;i++){const bin=Math.min(snap.frequency.length-1,Math.round(Math.pow(i/47,1.8)*128)),level=snap.frequency[bin]||0;const x=sx+i*sw/48;c.fillStyle=rgba(v.wireColour,.13);c.fillRect(x,sy,1,2);if(level>.02){c.fillStyle=rgba(v.signalColour,.3+level*.6);c.fillRect(x,sy-sh*level,Math.max(1,sw/48-2),sh*level);}}
    const x=r.x+r.w*.12,y=r.y+r.h-13,w=r.w*.57;
    line(c,[[x,y],[x+w,y]],rgba(v.wireColour,.3),.8);for(let i=0;i<5;i++)line(c,[[x+w*i/4,y-2],[x+w*i/4,y+2]],rgba(v.wireColour,.45),.7);
    const p=clamp(api.state.sound.material);c.fillStyle=v.signalColour;c.fillRect(x+w*p-1.5,y-3.5,3,7);
    label(ui,'MATERIAL',x+w*.5,y-12,muted,9,'center');
    const dx=r.x+12,dy=r.y+44,dh=Math.max(15,r.h-83);line(c,[[dx,dy],[dx,dy+dh]],rgba(v.wireColour,.18),.7);c.fillStyle=v.signalColour;c.fillRect(dx-3,dy+dh*api.state.sound.damping-1,6,2);
    ui.save();ui.translate(dx-2,dy+dh*.5);ui.rotate(-Math.PI/2);label(ui,'DAMPING',0,-10,muted,9,'center');ui.restore();
    for(const contact of contacts.values())if(contact.kind==='chamber'){const xx=contact.x??r.x+r.w*.5,yy=contact.y??r.y+r.h*.5;ui.strokeStyle=rgba(v.signalColour,.7);ui.lineWidth=.7;ui.beginPath();ui.arc(xx,yy,13,0,TAU);ui.stroke();line(ui,[[xx-19,yy],[xx-8,yy]],v.signalColour,.7);line(ui,[[xx+8,yy],[xx+19,yy]],v.signalColour,.7);label(ui,`M ${api.state.sound.material.toFixed(2)} / D ${api.state.sound.damping.toFixed(2)}`,clamp(xx,r.x+70,r.x+r.w-70),Math.max(r.y+27,yy-25),v.signalColour,9,'center');}
  }
  function controls(v,l,snap){
    const muted=rgba(v.wireColour,v.readoutContrast*.9),fg=rgba('#c6ced1',v.readoutContrast),r=l.sequence,step=(snap.step||0)%16;
    label(ui,'SEQ / 16',r.x,r.y-17,muted,10);label(ui,`${String(step+1).padStart(2,'0')} · ${api.state.playing?'RUN':'STOP'}`,r.x+r.w,r.y-17,muted,10,'right');
    for(let i=0;i<16;i++){const cell=r.w/16,x=r.x+i*cell,on=api.state.playing&&i===step,enabledStep=enabled[i],value=clamp((pattern[i]+7)/28);ui.fillStyle=on?rgba(v.signalColour,.14):'rgba(90,108,120,.025)';ui.fillRect(x+1,r.y,cell-2,r.h);ui.strokeStyle=rgba(v.wireColour,on?.45:.16);ui.lineWidth=.6;ui.strokeRect(x+1,r.y,cell-2,r.h);ui.fillStyle=rgba(v.signalColour,enabledStep?(on?1:.65):.12);const y=r.y+r.h-6-value*(r.h-12);ui.fillRect(x+cell*.24,y,cell*.52,2);label(ui,String(pattern[i]),x+cell*.5,r.y+r.h+10,enabledStep?muted:rgba(v.wireColour,.2),l.w<700?9:10,'center');}
    for(let i=0;i<3;i++){const d=l.dials[i],[key,name]=DIALS[i],value=clamp(api.state.sound[key]),a=Math.PI*.75+value*Math.PI*1.5;
      const grad=ui.createRadialGradient(d.x-4,d.y-5,1,d.x,d.y,d.r+2);grad.addColorStop(0,'#354049');grad.addColorStop(.64,'#151d23');grad.addColorStop(.88,'#080d11');grad.addColorStop(1,'#48535c');ui.fillStyle=grad;ui.beginPath();ui.arc(d.x,d.y,d.r,0,TAU);ui.fill();ui.strokeStyle=rgba(v.wireColour,.25);ui.lineWidth=.6;ui.beginPath();ui.arc(d.x,d.y,d.r+4,Math.PI*.75,Math.PI*2.25);ui.stroke();ui.strokeStyle=rgba(v.signalColour,.85);ui.lineWidth=1.2;ui.beginPath();ui.arc(d.x,d.y,d.r+4,Math.PI*.75,a);ui.stroke();line(ui,[[d.x+Math.cos(a)*d.r*.58,d.y+Math.sin(a)*d.r*.58],[d.x+Math.cos(a)*d.r*.9,d.y+Math.sin(a)*d.r*.9]],v.signalColour,1.8);
      label(ui,name,d.x+d.r+11,d.y-5,muted,l.w<900?9:10);label(ui,value.toFixed(2),d.x+d.r+11,d.y+9,fg,10);
    }
  }
  return{
    frame(t,dt){if(destroyed||!frameGate.due(t*1000))return;dt=Math.min(.1,time?t-time:dt);time=t;surface.resize();overlay.resize();const l=getLayout(),v={...definition.defaultAppearance,...api.state.appearance},snap=api.audio.snapshot(),timeMotion=api.reducedMotion?0:t;
      const newest=snap.voices.filter(v=>v.level>.001).sort((a,b)=>b.started-a.started)[0];if(newest)latestNote=newest.midi;
      ui.clearRect(0,0,l.w,l.h);background(v,l);
      const audioDt=Math.max(0,Math.min(.1,snap.time-lastAudioTime)),speed=api.state.bpm/112*v.packetSpeed*.42;lastAudioTime=snap.time;for(let i=0;i<8;i++){for(const p of packets[i])p.progress+=audioDt*speed;packets[i]=packets[i].filter(p=>p.progress<1);}
      const levels=Array(8).fill(0),gates=Array(8).fill(false),notes=Array.from({length:8},(_,i)=>api.quantize(relayNote(i,api.state.scale)));for(const voice of snap.voices){let index=notes.indexOf(voice.midi);if(index<0){const matching=notes.map((note,i)=>({note,i})).filter(({note})=>((note-voice.midi)%12+12)%12===0);index=matching.length?matching.reduce((a,b)=>Math.abs(a.note-voice.midi)<Math.abs(b.note-voice.midi)?a:b).i:notes.reduce((best,n,i)=>Math.abs(n-voice.midi)<Math.abs(notes[best]-voice.midi)?i:best,0);}levels[index]=Math.max(levels[index],voice.level*2.7);gates[index] ||= voice.gate;if(voice.started>launches[index]){launches[index]=voice.started;lastFlow[index]=snap.time;packets[index].push({progress:Math.max(0,(snap.time-voice.started)*speed),strength:clamp(voice.level*2.7,.45,1)});if(packets[index].length>8)packets[index].shift();}}for(let i=0;i<8;i++){const level=levels[i];if(gates[i]&&level>.06&&snap.time-lastFlow[i]>.9){packets[i].push({progress:0,strength:clamp(level,.35,1)});if(packets[i].length>8)packets[i].shift();lastFlow[i]=snap.time;}energy[i]=lerp(energy[i],clamp(level),1-Math.exp(-Math.min(.1,dt)*(level>energy[i]?24:4)));}
      circuits(v,l,snap.time,api.reducedMotion);bank(v,l,timeMotion);
      const activity=Math.max(snap.rms*6,...energy)*v.vibration;
      if(!metal.render(l.hero,t,api.state.sound,v,activity,api.reducedMotion))fallback(v,l,timeMotion,activity);
      chamber(v,l,snap);controls(v,l,snap);
      const fg=rgba('#c6ced1',v.readoutContrast),muted=rgba(v.wireColour,v.readoutContrast*.88);
      label(ui,'EXCITER / 08',l.pad,15,muted,l.w<700?9:10);label(ui,'MODAL RESONATOR',l.portrait?l.w-l.pad:l.chamber.x,15,muted,l.w<700?9:10,l.portrait?'right':'left');
      if(!l.portrait){label(ui,api.noteName(latestNote),l.bank.x+l.bank.w,15,fg,13,'right');label(ui,`M ${api.state.sound.material.toFixed(2)} / D ${api.state.sound.damping.toFixed(2)}`,l.w-l.pad,15,fg,10,'right');}
      const status=`${api.noteName(latestNote)} · ${snap.voices.filter(v=>v.gate).length} voices`;if(status!==lastStatus){api.setStatus(status);lastStatus=status;}
      for(const id of owned)if(!contacts.has(id)&&!snap.voices.some(v=>v.id==='relay-'+id)&&!api.state.hold)owned.delete(id);
    },
    onStep(step,when){const index=((step%16)+16)%16;if(!enabled[index])return;const degree=pattern[index],midi=api.quantize(degree);api.audio.pulse('relay-step-'+index,midi,{...api.state.sound,velocity:index%4===0?.85:.64,pan:(index%4-1.5)*.12},when,60/api.state.bpm/4*api.state.sound.gate);},
    update(){/* Sound configuration is owned by the host; visual edits must not reset contact expression. */},
    cancel(){for(const id of owned)cancelNote(id);contacts.clear();},
    getData(){return{pattern:[...pattern],enabled:[...enabled],lastDegree};},
    setData(data){if(Array.isArray(data?.pattern))for(let i=0;i<16;i++)if(Number.isFinite(data.pattern[i]))pattern[i]=Math.round(clamp(data.pattern[i],-7,21));if(Array.isArray(data?.enabled))for(let i=0;i<16;i++)if(typeof data.enabled[i]==='boolean')enabled[i]=data.enabled[i];if(Number.isFinite(data?.lastDegree))lastDegree=Math.round(clamp(data.lastDegree,-7,21));},
    destroy(){destroyed=true;unbind();for(const id of owned)cancelNote(id);contacts.clear();metal.destroy();surface.destroy();overlay.destroy();}
  };
}
