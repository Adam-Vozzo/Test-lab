import { bindPointers, clamp, createSurface, label, line, rgba, TAU } from './kit.js';
import { splitLayout } from '../instrument-layout.js';

const mint = '#a9f7cd';
const amber = '#ffc978';
const ink = '#333b33';

function panel(c,x,y,w,h,r,fill) {
  c.beginPath();
  c.roundRect(x,y,w,h,r);
  c.fillStyle=fill;
  c.fill();
}

function vertical(c,y,height,stops) {
  const gradient=c.createLinearGradient(0,y,0,y+height);
  for(const [at,colour] of stops) gradient.addColorStop(at,colour);
  return gradient;
}

function caseFinish(c) {
  const tile=document.createElement('canvas');tile.width=tile.height=64;
  const paint=tile.getContext('2d');
  for(let i=0;i<340;i++){
    const x=(i*31+Math.floor(i/64)*17)%64,y=(i*i*7+i*5+Math.floor(i/8))%64;
    paint.fillStyle=i%3?'#2b352509':'#fff9da22';paint.fillRect(x,y,1,1);
  }
  return c.createPattern(tile,'repeat');
}

function housing(c,w,h,finish) {
  panel(c,0,0,w,h,10,'#42473e');
  panel(c,1,1,w-2,h-4,9,vertical(c,0,h,[[0,'#ede7d2'],[.025,'#ccc9b7'],[.76,'#c2bdab'],[1,'#9d9e8f']]));
  panel(c,2,2,w-4,h-7,8,finish);
  for(const x of [7,w-7])for(const y of [7,h-8]){
    c.beginPath();c.arc(x,y,3.3,0,TAU);c.fillStyle='#7c7f72';c.fill();
    line(c,[[x-1.7,y+1.4],[x+1.7,y-1.4]],'#41493f',1.2);
  }
}

function meter(c,bpm,x,y,h) {
  const width=h*.56, gap=h*.14;
  const digits=String(bpm).padStart(3,'0');
  panel(c,x-6,y-5,3*(width+gap)+5,h+10,3,'#7e8071');
  panel(c,x-5,y-4,3*(width+gap)+3,h+8,2,'#17231c');
  const segments=[[.13,0,.87,0],[1,.1,1,.44],[1,.56,1,.90],[.13,1,.87,1],[0,.56,0,.90],[0,.1,0,.44],[.13,.50,.87,.50]];
  const masks=[63,6,91,79,102,109,125,7,127,111];
  digits.split('').forEach((digit,i)=>segments.forEach(([ax,ay,bx,by],j)=>{
    const xx=x+i*(width+gap);
    line(c,[[xx+ax*width,y+ay*h],[xx+bx*width,y+by*h]],masks[digit]&(1<<j)?'#d4f5a3':'#29392b',Math.max(2,h*.115));
  }));
}

export const definition = {
  id: 'telemetry', name: 'Telemetry', keyboardNotes: true,
  theme: { bg: '#091814', fg: '#daeee2', accent: mint, muted: '#759a8a' },
  defaultSound: { waveform: 'sine', gain: .50, attack: .006, decay: .13, sustain: .36, release: .34, cutoff: 2300 },
  defaultAppearance: { persistence: .72, halation: .8 },
  appearanceControls: [
    { key:'halation', label:'Beam halation', section:'Scope', min:0, max:1, step:.01, description:'Amount of amber light scattered around the live trace.' },
    { key:'persistence', label:'Phosphor persistence', section:'Scope', min:0, max:1, step:.01, description:'Brightness of the previous waveform traces on the scope.' }]
};

function impulse(age, strength) {
  const bell = (centre, width) => Math.exp(-Math.pow((age-centre)/width,2));
  return strength*(.13*bell(.06,.028)-.18*bell(.14,.012)+bell(.17,.016)-.42*bell(.20,.021)+.24*bell(.34,.075));
}

export function mount(host, api) {
  const surface = createSurface(host,{label:'Telemetry. Touch the ECG strip to strike a pulse. Drag the scope to tune pitch and harmonics. Tap beat contacts to edit the pattern.'});
  const c = surface.ctx, contacts = new Map(), beats = [], ghosts = [];
  const finish=caseFinish(c);
  let lastGeometry="";
  const pressedKeys=new Map();
  let pattern = [1,0,2,0,1,1,2,0], degree=3, harmonic=2, stamp=-1, step=0;
  const layout = () => splitLayout(surface.width,surface.height,api.state.appearance,{pad:8});
  const sound = (strength) => ({waveform:'triangle', velocity:strength, attack:.003, decay:.09, sustain:.15, release:.16, cutoff:900+strength*1300});
  function strike(when, strength, index) {
    beats.push({when,strength,index});
    if(beats.length>96) beats.shift();
  }
  function scopeNote(p, box) {
    degree=Math.round(clamp((p.x-box.x)/box.w)*14);
    harmonic=1+Math.round(clamp(1-(p.y-box.y)/box.h)*7);
    return {waveform:'sine',ratio:harmonic,index:1+harmonic*.5,velocity:.66,cutoff:4800};
  }
  function touch(p, first) {
    const {left,right} = layout();
    if(first){
      const within = q => p.x>=q.x && p.x<=q.x+q.w && p.y>=q.y && p.y<=q.y+q.h;
      if(!within(left)&&!within(right)) return false;
      const zone=within(right)?'scope':p.y>left.y+left.h*.8?'contacts':'strip';
      contacts.set(p.id,zone);
    }
    const zone=contacts.get(p.id), id='telemetry-touch-'+p.id;
    if(zone==='scope'){
      const opts=scopeNote(p,right);
      (first?api.noteOn:api.noteUpdate)(id,api.quantize(degree),opts);
    } else if(first){
      const index=Math.floor(clamp((p.x-left.x)/left.w,0,.999)*8);
      if(zone==='contacts'){pattern[index]=(pattern[index]+1)%3;pressedKeys.set(p.id,index);}
      const strength=zone==='contacts'?(pattern[index]===2?1:.55):clamp(1-(p.y-left.y)/left.h,.35,1);
      strike(api.audio.now,strength,index);
      api.noteOn(id,api.quantize(index%4-5),sound(strength));
    }
  }
  const unbind=bindPointers(surface.canvas,{
    down:p=>touch(p,true),move:p=>touch(p,false),
    up(p){api.noteOff('telemetry-touch-'+p.id);contacts.delete(p.id);pressedKeys.delete(p.id);api.save();},
    cancel(p){api.noteCancel('telemetry-touch-'+p.id);contacts.delete(p.id);pressedKeys.delete(p.id);}
  });
  function plotGrid(x,y,w,h,cols,rows) {
    for(let i=0;i<=cols;i++)line(c,[[x+i*w/cols,y],[x+i*w/cols,y+h]],i%4?'#c293834c':'#bd84749c');
    for(let i=0;i<=rows;i++)line(c,[[x,y+i*h/rows],[x+w,y+i*h/rows]],i%3?'#c293834c':'#bd84749c');
  }
  function strip(box,snapshot) {
    const {y,h}=box, x=box.x+8,w=box.w-16, top=y+h*.24, bottom=y+h*.76, now=snapshot.time;
    label(c,'ECG   /   LEAD I',x+4,y+8,ink,10);
    const digitHeight=Math.min(36,h*.085);
    meter(c,api.state.bpm,x+9,y+h*.14-digitHeight/2,digitHeight);
    label(c,'BPM',x+digitHeight*2.1+19,y+h*.14,ink,10);
    label(c,'3 SEC   /   STRIP',x+w-2,y+h*.14,ink,10,'right');
    panel(c,x-4,top-4,w+8,bottom-top+9,4,'#54594f');
    panel(c,x-1,top-1,w+2,bottom-top+2,1,vertical(c,top,bottom-top,[[0,'#b3a88e'],[.045,'#e9dfc9'],[.90,'#f4e9d5'],[1,'#ded3b9']]));
    plotGrid(x,top,w,bottom-top,32,12);
    if(!snapshot.time && !beats.length){
      const reference=[];
      for(let i=0;i<=w;i+=2)reference.push([x+i,top+(bottom-top)*(.61-impulse((i/w*3)%.9,.8)*.52)]);
      line(c,reference,'#7b8374',1);
      label(c,'REFERENCE',x+w-4,top+9,'#696751',8,'right');
    }
    const points=[];
    for(let i=0;i<=w;i+=2){
      const at=now-3*(1-i/w);
      let voltage=0;
      for(let j=beats.length-1;j>=0;j--){const age=at-beats[j].when;if(age>.65)break;if(age>=0)voltage+=impulse(age,beats[j].strength);}
      points.push([x+i,top+(bottom-top)*(.61-voltage*.52)]);
    }
    line(c,points,'#37453e',1.7);
    label(c,'PULSE CONTACTS   /   REST · BEAT · ACCENT',x+3,bottom+15,ink,Math.min(9,w/38));
    const cy=y+h*.90, gap=w/8;
    pattern.forEach((value,i)=>{
      const cx=box.x+box.w*(i+.5)/8, radius=Math.min(gap*.27,h*.055);
      const cap=radius*2, pressed=[...pressedKeys.values()].includes(i);
      panel(c,cx-radius-2,cy-radius-1,cap+4,cap+6,4,'#55594e');
      panel(c,cx-radius,cy-radius+(pressed?3:0),cap,cap,3,vertical(c,cy-radius,cap,[
        [0,value===2?'#ffd08e':value?'#c6cfb2':'#989f90'],
        [.16,value===2?'#cd9753':value?'#879d83':'#626f65'],
        [1,value===2?'#9c6436':value?'#52695a':'#414c43']]));
      if(i===step){c.fillStyle='#b76931';c.fillRect(cx-radius*.55,cy+radius+6,radius*1.1,2);}
      if(value){for(let tick=0;tick<value;tick++){const tx=cx+(tick-(value-1)/2)*4;line(c,[[tx,cy-radius*.35],[tx,cy+radius*.35]],mint,2);}}
      else{c.fillStyle='#638272';c.fillRect(cx-1,cy-1,2,2);}
    });
  }
  function drawBeam(cx,cy,r) {
    const {halation,persistence}=api.state.appearance;
    c.lineCap='round';
    c.lineJoin='round';
    ghosts.forEach(({path,peak},i)=>{
      const age=ghosts.length-1-i;
      if(age){
        c.strokeStyle=rgba('#f39a40',persistence*.38*Math.pow(.67,age-1));
        c.lineWidth=1.5;
        c.stroke(path);
        return;
      }
      if(peak<.001){
        c.fillStyle='#e7ad64';
        c.beginPath();c.arc(cx,cy,1,0,TAU);c.fill();
        return;
      }
      // Stroke the entire projected signal as a single filament so crossings
      // cannot accumulate a full-screen wash on harmonically dense notes.
      const heat=.4+.6*clamp(Math.sqrt(peak)*2.5);
      for(const [width,colour,opacity] of [
        [.15,'#ff6515',.06],[.09,'#ff7a25',.11],
        [.05,'#ff992d',.23],[.026,'#ffc159',.48]
      ]){
        c.strokeStyle=rgba(colour,halation*heat*opacity);
        c.lineWidth=Math.max(2,r*width);
        c.stroke(path);
      }
      c.strokeStyle='#ffb751';c.lineWidth=2.1;c.stroke(path);
      c.strokeStyle=rgba('#fff7cf',.55+.45*heat);c.lineWidth=1;c.stroke(path);
    });
  }
  function scope(box,snapshot) {
    const {x,y,w,h}=box,cx=x+w*.5,cy=y+h*.49,r=Math.min(w*.44,h*.37);
    label(c,'VECTOR OSCILLOSCOPE',x+8,y+11,ink,10);
    if(w>225)for(let i=0;i<7;i++){
      const vx=x+w-12-i*6;
      panel(c,vx,y+7,3,11,1,'#dedbc9');panel(c,vx,y+7,3,9,1,'#71776c');
    }
    const bezel=c.createLinearGradient(cx-r,cy-r,cx+r,cy+r);
    bezel.addColorStop(0,'#dadac6');bezel.addColorStop(.35,'#858a7c');bezel.addColorStop(.6,'#444b43');bezel.addColorStop(1,'#9fa698');
    c.beginPath();c.arc(cx,cy,r+10,0,TAU);c.fillStyle=bezel;c.fill();
    c.beginPath();c.arc(cx,cy,r+6,0,TAU);c.fillStyle='#242d27';c.fill();
    const trace=snapshot.waveform;
    const geometry=[x,y,w,h].join('/');
    if(geometry!==lastGeometry){ghosts.length=0;stamp=-1;lastGeometry=geometry;}
    if(snapshot.time-stamp>.045){
      let peak=0;
      for(const sample of trace) peak=Math.max(peak,Math.abs(sample));
      const gain=peak>.001?Math.min(42,.84/peak):0;
      const lag=5+harmonic*2;
      const path=new Path2D();
      for(let i=0;i<trace.length-lag;i+=2){
        const px=cx+clamp(trace[i]*gain,-1,1)*r,py=cy-clamp(trace[i+lag]*gain,-1,1)*r;
        if(i===0)path.moveTo(px,py);else path.lineTo(px,py);
      }
      ghosts.push({path,peak});if(ghosts.length>5)ghosts.shift();stamp=snapshot.time;
    }
    const halo=c.createRadialGradient(cx,cy,0,cx,cy,r);halo.addColorStop(0,'#46301c');halo.addColorStop(.76,'#302117');halo.addColorStop(.96,'#20160f');halo.addColorStop(1,'#4a3220');
    c.fillStyle=halo;c.beginPath();c.arc(cx,cy,r,0,TAU);c.fill();
    for(let i=1;i<=4;i++){c.beginPath();c.arc(cx,cy,r*i/4,0,TAU);c.strokeStyle=i===4?'#977a52':'#57402a';c.stroke();}
    for(let i=0;i<64;i++){const a=i*TAU/64,len=i%8===0?9:3;
      line(c,[[cx+Math.cos(a)*(r-len),cy+Math.sin(a)*(r-len)],[cx+Math.cos(a)*r,cy+Math.sin(a)*r]],'#a28459');}
    line(c,[[cx-r,cy],[cx+r,cy]],'#6a4d31');line(c,[[cx,cy-r],[cx,cy+r]],'#6a4d31');
    // The reference ellipse stays dim underneath the live time-delay projection.
    const guide=[];
    for(let i=0;i<=120;i++){const phase=i*TAU/120;guide.push([cx+r*.62*Math.sin(phase),cy-r*.55*Math.sin(phase+harmonic*.12)]);}
    line(c,guide,'#795532',1);
    label(c,'REF',cx+r*.53,cy-r*.58,'#bf9364',8);
    c.save();c.beginPath();c.arc(cx,cy,r,0,TAU);c.clip();
    const glass=c.createLinearGradient(cx-r,cy-r,cx+r,cy+r);
    glass.addColorStop(0,'#ffecd320');glass.addColorStop(.44,'#f7cf9108');glass.addColorStop(.45,'#ffffff00');glass.addColorStop(1,'#1a0d0250');
    c.fillStyle=glass;c.fillRect(cx-r,cy-r,2*r,2*r);
    drawBeam(cx,cy,r);
    c.restore();
    panel(c,cx-45,y+h*.91-10,90,21,3,'#323a31');
    label(c,api.noteName(api.quantize(degree))+'   ×'+harmonic,cx,y+h*.91,amber,16,'center');
    label(c,'X   PITCH     /     Y   FM RATIO',cx,y+h*.98,ink,9,'center');
  }
  return {
    frame(){surface.resize();const snapshot=api.audio.snapshot(),{left,right}=layout();c.clearRect(0,0,surface.width,surface.height);
      while(beats.length&&snapshot.time-beats[0].when>4)beats.shift();
      const latest=beats.findLast(b=>b.when<=snapshot.time);if(latest)step=latest.index;
      housing(c,surface.width,surface.height,finish);
      strip(left,snapshot);scope(right,snapshot);},
    onStep(n,when){if(n%2)return;const index=(n/2)%8,value=pattern[index];strike(when,value===2?1:value*.66,index);if(!value)return;
      api.audio.pulse('telemetry-low',api.quantize(-7+index%3),sound(value===2?1:.7),when,.09);
      api.audio.pulse('telemetry-return',api.quantize(degree),{waveform:'sine',ratio:harmonic,index:1.8,velocity:.36,release:.23},when+.115,.055);
    },
    cancel(){for(const id of contacts.keys())api.noteCancel('telemetry-touch-'+id);contacts.clear();pressedKeys.clear();beats.length=0;},
    getData:()=>({pattern:[...pattern],degree,harmonic}),
    setData(data){if(data?.pattern?.length===8&&Array.isArray(data.pattern))pattern=data.pattern.map(n=>Math.round(clamp(n,0,2)));degree=Math.round(clamp(data?.degree??3,0,14));harmonic=Math.round(clamp(data?.harmonic??2,1,8));},
    destroy(){unbind();surface.destroy();}
  };
}
