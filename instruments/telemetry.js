import { bindPointers, clamp, createSurface, label, line, rgba, TAU } from './kit.js';
import { splitLayout } from '../instrument-layout.js';

const mint = '#a9f7cd';
const amber = '#ffc978';
export const definition = {
  id: 'telemetry', name: 'Telemetry', keyboardNotes: true,
  theme: { bg: '#091814', fg: '#daeee2', accent: mint, muted: '#759a8a' },
  defaultSound: { waveform: 'sine', gain: .50, attack: .006, decay: .13, sustain: .36, release: .34, cutoff: 2300 },
  defaultAppearance: { persistence: .72 },
  appearanceControls: [{ key:'persistence', label:'Phosphor persistence', section:'Scope', min:0, max:1, step:.01, description:'Brightness of the previous waveform traces on the scope.' }]
};

function impulse(age, strength) {
  const bell = (centre, width) => Math.exp(-Math.pow((age-centre)/width,2));
  return strength*(.13*bell(.06,.028)-.18*bell(.14,.012)+bell(.17,.016)-.42*bell(.20,.021)+.24*bell(.34,.075));
}

export function mount(host, api) {
  const surface = createSurface(host,{label:'Telemetry. Touch the ECG strip to strike a pulse. Drag the scope to tune pitch and harmonics. Tap beat contacts to edit the pattern.'});
  const c = surface.ctx, contacts = new Map(), beats = [], ghosts = [];
  let lastGeometry="";
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
      if(zone==='contacts') pattern[index]=(pattern[index]+1)%3;
      const strength=zone==='contacts'?(pattern[index]===2?1:.55):clamp(1-(p.y-left.y)/left.h,.35,1);
      strike(api.audio.now,strength,index);
      api.noteOn(id,api.quantize(index%4-5),sound(strength));
    }
  }
  const unbind=bindPointers(surface.canvas,{
    down:p=>touch(p,true),move:p=>touch(p,false),
    up(p){api.noteOff('telemetry-touch-'+p.id);contacts.delete(p.id);api.save();},
    cancel(p){api.noteCancel('telemetry-touch-'+p.id);contacts.delete(p.id);}
  });
  function plotGrid(x,y,w,h,cols,rows) {
    for(let i=0;i<=cols;i++)line(c,[[x+i*w/cols,y],[x+i*w/cols,y+h]],i%4?'#19372c':'#335444');
    for(let i=0;i<=rows;i++)line(c,[[x,y+i*h/rows],[x+w,y+i*h/rows]],i%3?'#19372c':'#335444');
  }
  function strip(box,snapshot) {
    const {x,y,w,h}=box, top=y+h*.24, bottom=y+h*.76, now=snapshot.time;
    label(c,'I   /   ELECTROCARDIOGRAM',x+5,y+11,mint,10);
    label(c,String(api.state.bpm),x+5,y+h*.14,mint,Math.min(47,h*.16));
    label(c,'BPM',x+Math.min(88,h*.30),y+h*.14,'#91bca4',10);
    label(c,'3.0 s   /   SWEEP',x+w-4,y+h*.14,amber,9,'right');
    plotGrid(x,top,w,bottom-top,24,6);
    if(!snapshot.time && !beats.length){
      const reference=[];
      for(let i=0;i<=w;i+=2)reference.push([x+i,top+(bottom-top)*(.61-impulse((i/w*3)%.9,.8)*.52)]);
      line(c,reference,'#587962',1);
      label(c,'REFERENCE',x+w-4,top+9,'#9eb4a4',8,'right');
    }
    const points=[];
    for(let i=0;i<=w;i+=2){
      const at=now-3*(1-i/w);
      let voltage=0;
      for(let j=beats.length-1;j>=0;j--){const age=at-beats[j].when;if(age>.65)break;if(age>=0)voltage+=impulse(age,beats[j].strength);}
      points.push([x+i,top+(bottom-top)*(.61-voltage*.52)]);
    }
    line(c,points,rgba(mint,.14),5);line(c,points,mint,1.7);
    label(c,'PULSE CONTACTS   /   REST · BEAT · ACCENT',x+3,bottom+10,'#9cb8a8',Math.min(9,w/38));
    const cy=y+h*.90, gap=w/8;
    pattern.forEach((value,i)=>{
      const cx=x+gap*(i+.5), radius=Math.min(gap*.27,h*.055);
      c.beginPath();c.arc(cx,cy,radius,0,TAU);c.fillStyle=value===2?'#a97138':value?'#43725a':'#14281e';c.fill();
      c.strokeStyle=i===step?amber:'#6d937f';c.stroke();
      if(value){for(let tick=0;tick<value;tick++){const tx=cx+(tick-(value-1)/2)*4;line(c,[[tx,cy-radius*.35],[tx,cy+radius*.35]],mint,2);}}
      else{c.fillStyle='#638272';c.fillRect(cx-1,cy-1,2,2);}
    });
  }
  function scope(box,snapshot) {
    const {x,y,w,h}=box,cx=x+w*.5,cy=y+h*.49,r=Math.min(w*.44,h*.37);
    label(c,'II   /   VECTOR SCOPE',x+4,y+11,amber,10);
    const trace=snapshot.waveform;
    const geometry=[x,y,w,h].join('/');
    if(geometry!==lastGeometry){ghosts.length=0;stamp=-1;lastGeometry=geometry;}
    if(snapshot.time-stamp>.045){
      let peak=0;
      for(const sample of trace) peak=Math.max(peak,Math.abs(sample));
      const gain=peak>.001?Math.min(42,.84/peak):0;
      const lag=5+harmonic*2;
      const points=[];
      for(let i=0;i<trace.length-lag;i+=2)points.push([cx+clamp(trace[i]*gain,-1,1)*r,cy-clamp(trace[i+lag]*gain,-1,1)*r]);
      ghosts.push(points);if(ghosts.length>5)ghosts.shift();stamp=snapshot.time;
    }
    const halo=c.createRadialGradient(cx,cy,0,cx,cy,r);halo.addColorStop(0,'#244333');halo.addColorStop(1,'#0e2019');
    c.fillStyle=halo;c.beginPath();c.arc(cx,cy,r,0,TAU);c.fill();
    for(let i=1;i<=4;i++){c.beginPath();c.arc(cx,cy,r*i/4,0,TAU);c.strokeStyle=i===4?'#739880':'#385641';c.stroke();}
    for(let i=0;i<64;i++){const a=i*TAU/64,len=i%8===0?9:3;
      line(c,[[cx+Math.cos(a)*(r-len),cy+Math.sin(a)*(r-len)],[cx+Math.cos(a)*r,cy+Math.sin(a)*r]],'#839881');}
    line(c,[[cx-r,cy],[cx+r,cy]],'#47644c');line(c,[[cx,cy-r],[cx,cy+r]],'#47644c');
    // The reference ellipse stays dim underneath the live time-delay projection.
    const guide=[];
    for(let i=0;i<=120;i++){const phase=i*TAU/120;guide.push([cx+r*.62*Math.sin(phase),cy-r*.55*Math.sin(phase+harmonic*.12)]);}
    line(c,guide,'#426044',1);
    label(c,'REF',cx+r*.53,cy-r*.58,'#73987a',8);
    c.save();c.beginPath();c.arc(cx,cy,r,0,TAU);c.clip();
    ghosts.forEach((points,i)=>line(c,points,i===ghosts.length-1?amber:rgba(amber,api.state.appearance.persistence*.16*(i+1)/5),i===ghosts.length-1?1.6:2));
    c.restore();
    label(c,api.noteName(api.quantize(degree))+'   ×'+harmonic,cx,y+h*.91,amber,16,'center');
    label(c,'X   PITCH     /     Y   FM RATIO',cx,y+h*.98,'#a3b9a3',9,'center');
  }
  return {
    frame(){surface.resize();const snapshot=api.audio.snapshot(),{left,right}=layout();c.clearRect(0,0,surface.width,surface.height);
      while(beats.length&&snapshot.time-beats[0].when>4)beats.shift();
      const latest=beats.findLast(b=>b.when<=snapshot.time);if(latest)step=latest.index;
      strip(left,snapshot);scope(right,snapshot);},
    onStep(n,when){if(n%2)return;const index=(n/2)%8,value=pattern[index];strike(when,value===2?1:value*.66,index);if(!value)return;
      api.audio.pulse('telemetry-low',api.quantize(-7+index%3),sound(value===2?1:.7),when,.09);
      api.audio.pulse('telemetry-return',api.quantize(degree),{waveform:'sine',ratio:harmonic,index:1.8,velocity:.36,release:.23},when+.115,.055);
    },
    cancel(){for(const id of contacts.keys())api.noteCancel('telemetry-touch-'+id);contacts.clear();beats.length=0;},
    getData:()=>({pattern:[...pattern],degree,harmonic}),
    setData(data){if(data?.pattern?.length===8&&Array.isArray(data.pattern))pattern=data.pattern.map(n=>Math.round(clamp(n,0,2)));degree=Math.round(clamp(data?.degree??3,0,14));harmonic=Math.round(clamp(data?.harmonic??2,1,8));},
    destroy(){unbind();surface.destroy();}
  };
}
