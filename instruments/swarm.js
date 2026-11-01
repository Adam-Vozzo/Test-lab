import {createSurface,bindPointers,clamp,lerp,TAU} from './kit.js';

const range=(key,label,min,max,step,unit,section,description)=>({key,label,min,max,step,unit,section,description});
export const definition={
  id:'swarm',name:'Machine / Swarm',batch:3,
  theme:{bg:'#08090d',fg:'#f0efe9',accent:'#e2c866',muted:'#a6a2b8'},
  defaultSound:{waveform:'sawtooth',attack:.018,decay:.22,sustain:.42,release:.9,cutoff:2400,resonance:2.8,detune:6,ratio:2,index:0,translate:0,spread:7},
  defaultAppearance:{streakCount:1050,streakLength:1.35,curl:.7,inertia:.68,disturbance:.8,recovery:.5,emission:.55,wireOpacity:.6,fieldScale:.88,seed:19},
  soundControls:[
    {key:'waveform',label:'Oscillator',kind:'select',options:[['sawtooth','Saw'],['square','Pulse'],['triangle','Triangle'],['sine','Sine']],section:'Source',description:'Waveform voiced by pitch lanes and swarm contacts.'},
    range('cutoff','Filter cutoff',80,12000,10,'Hz','Source','Brightness of every sounding lane and contact.'),
    range('resonance','Filter resonance',.2,9,.1,'Q','Source','Emphasis at the cutoff frequency.'),
    range('translate','Pitch translation',-12,12,1,'st','Transform','Transposes the pitch lanes and swarm notes.'),
    range('spread','Pitch spread',0,19,1,'st','Transform','Pitch interval added as a contact moves outward.'),
    range('ratio','FM ratio',.25,8,.25,'×','Modulation','Modulator frequency relative to the oscillator.'),
    range('index','FM index',0,8,.1,'','Modulation','Frequency-modulation depth; zero leaves the source unmodulated.'),
    range('attack','Attack',.005,1,.005,'s','Envelope','Time for a voice and its visible pulse to rise.'),
    range('release','Release',.05,4,.05,'s','Envelope','Voice and contact trail release duration.')
  ],
  appearanceControls:[
    range('streakCount','Streak count',300,1800,50,'','Swarm','Number of independently moving white traces.'),
    range('streakLength','Streak length',.35,3,.05,'×','Swarm','Distance each moving particle leaves behind.'),
    range('curl','Ambient curl',.05,1.4,.05,'','Swarm','Slow circulation of the untouched field.'),
    range('inertia','Motion inertia',.05,.95,.01,'','Swarm','How long traces retain their current velocity.'),
    range('disturbance','Touch influence',0,1.6,.05,'','Gesture','Strength of the local disturbance around each finger.'),
    range('recovery','Field recovery',.1,1,.05,'','Gesture','Speed at which displaced traces return to the flow.'),
    range('fieldScale','Vortex extent',.55,1,.01,'','Swarm','Radius of the white field within its playing area.'),
    range('emission','Violet glow',0,1,.05,'','Connections','Emission on voice nodes and the two transformation loops.'),
    range('wireOpacity','Circuit weight',.15,1,.05,'','Connections','Opacity of pitch lanes and connecting gold wires.')
  ]
};

const original=[2,4,6,4,1,3,5,7,4,2,5,3,6,4,1,3];
const number=(v,d=0)=>Number.isFinite(v)?v:d;
const css=(c,a)=>{const h=c.replace('#','');const n=parseInt(h,16);return `rgba(${n>>16},${n>>8&255},${n&255},${a})`;};
function text(c,s,x,y,color='#bcb9b0',size=10,align='left'){c.fillStyle=color;c.font=`${size}px "SFMono-Regular",Consolas,monospace`;c.textAlign=align;c.fillText(s,x,y);}
function stroke(c,pts,color,width=1){c.strokeStyle=color;c.lineWidth=width;c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function rectangle(c,x,y,w,h,color){c.strokeStyle=color;c.lineWidth=.7;c.strokeRect(x,y,w,h);}
function hash(n){let x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);}

export function mount(host,api){
  const surface=createSurface(host,{label:'Pitch lanes and swarm. Drag a lane to edit its pitch. Drag the swarm to play and disturb the flow.',bg:'#08090d'});
  const {canvas,ctx:c}=surface;let steps=[...original],enabled=Array(16).fill(true),layout=null,particles=[],serial=0,lastT=0;
  const contacts=new Map(),roles=new Map(),releases=[];
  const actions=document.createElement('div');actions.style.cssText='position:absolute;display:flex;gap:7px;z-index:2;';
  const seedButton=document.createElement('button'),clearButton=document.createElement('button');
  for(const [button,name]of [[seedButton,'SEED'],[clearButton,'CLEAR']]){button.type='button';button.textContent=name;button.style.cssText='border:1px solid #726433;color:#d6c170;background:#0b0c10;padding:5px 9px;font:9px monospace;min-height:30px;';actions.append(button);}seedButton.setAttribute('aria-label','Generate a new pitch-lane sequence');clearButton.setAttribute('aria-label','Mute all pitch-lane steps');host.append(actions);
  let sequenceSeed=19;
  const regenerate=()=>{sequenceSeed++;steps=steps.map((_,i)=>Math.floor(hash(i+sequenceSeed*31)*8));enabled.fill(true);api.save();};
  const clear=()=>{enabled.fill(false);api.save();};seedButton.addEventListener('click',regenerate);clearButton.addEventListener('click',clear);
  const dispose=bindPointers(canvas,{down,move,up,cancel:up});
  canvas.style.cursor='crosshair';
  const a=()=>({...definition.defaultAppearance,...api.state.appearance});
  const s=()=>({...definition.defaultSound,...api.state.sound});
  function bounds(){
    const w=surface.width,h=surface.height,small=w<650,margin=Math.max(16,w*.022);
    if(small){const top=Math.max(150,h*.34);return{w,h,margin,small,machine:{x:margin,y:35,w:w-2*margin,h:top-35},field:{x:margin,y:top+12,w:w-2*margin,h:h-top-92},bridgeY:h-48};}
    return{w,h,margin,small,machine:{x:margin,y:38,w:w*.365-margin,h:h*.69},field:{x:w*.43,y:38,w:w*.55-margin,h:h*.73},bridgeY:h*.85};
  }
  function areas(){
    const b=layout||bounds(),m=b.machine;
    const gh=Math.max(72,m.h*(b.small?.48:.44));
    return{grid:{x:m.x+28,y:m.y+12,w:m.w-38,h:gh},sliders:{x:m.x+12,y:m.y+gh+42,w:m.w-24,h:Math.max(62,m.h-gh-37)}};
  }
  function inBox(p,b){return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h;}
  function soundFor(p){
    const f=layout.field,x=clamp((p.x-f.x)/f.w,0,1),y=clamp((p.y-f.y)/f.h,0,1),radius=Math.hypot(x-.5,(y-.5)*.85)*1.7;
    const z=s(),midi=api.quantize(Math.round(x*13),0)+z.translate+Math.round(clamp(radius,0,1)*z.spread);
    return{midi,options:{...z,cutoff:clamp(z.cutoff*Math.pow(2,(.5-y)*2),60,14000),pan:clamp((x-.5)*1.3,-.8,.8),gain:.11}};
  }
  function down(p){
    surface.resize();layout=bounds();const b=areas();
    if(inBox(p,b.grid)){roles.set(p.id,{kind:'grid'});editGrid(p);return;}
    if(inBox(p,b.sliders)){const row=clamp(Math.floor((p.y-b.sliders.y)/Math.max(1,b.sliders.h/4)),0,3);roles.set(p.id,{kind:'slider',row});editSlider(p,row);return;}
    if(inBox(p,layout.field)){roles.set(p.id,{kind:'voice'});const n=soundFor(p);contacts.set(p.id,{id:p.id,x:p.x,y:p.y,px:p.x,py:p.y,dx:0,dy:0,midi:n.midi,started:lastT});api.noteOn(`swarm-${p.id}`,n.midi,n.options);api.setStatus(`${api.noteName(n.midi)} · ${Math.round(n.options.cutoff)} Hz`);return;}
    return false;
  }
  function move(p){const role=roles.get(p.id);if(!role)return;if(role.kind==='grid')editGrid(p);else if(role.kind==='slider')editSlider(p,role.row);else{
    const q=contacts.get(p.id);if(!q)return;q.dx=clamp((p.x-q.x)/Math.max(layout.field.w,1),-.08,.08);q.dy=clamp((p.y-q.y)/Math.max(layout.field.h,1),-.08,.08);q.px=q.x;q.py=q.y;q.x=p.x;q.y=p.y;
    const n=soundFor(p);q.midi=n.midi;api.noteUpdate(`swarm-${p.id}`,n.midi,n.options);api.setStatus(`${api.noteName(n.midi)} · ${Math.round(n.options.cutoff)} Hz`);
  }}
  function up(p){const q=contacts.get(p.id);if(q){releases.push({...q,released:lastT});if(releases.length>16)releases.shift();api.noteOff(`swarm-${p.id}`);}contacts.delete(p.id);roles.delete(p.id);api.save();}
  function editGrid(p){const g=areas().grid,col=clamp(Math.floor((p.x-g.x)/g.w*16),0,15);steps[col]=clamp(7-Math.floor((p.y-g.y)/g.h*8),0,7);enabled[col]=true;api.save();}
  function editSlider(p,row){const box=areas().sliders,keys=['cutoff','resonance','translate','spread'],bounds=[[80,12000],[.2,9],[-12,12],[0,19]],key=keys[row],[lo,hi]=bounds[row],v=clamp((p.x-box.x-box.w*.25)/(box.w*.57),0,1),value=row===0?Math.round(lo*Math.pow(hi/lo,v)):row>1?Math.round(lerp(lo,hi,v)):Math.round(lerp(lo,hi,v)*10)/10;if(api.setSound)api.setSound({[key]:value});else{api.state.sound[key]=value;api.audio.configure(api.state.sound);api.save();}}
  function resetParticles(count){particles=Array.from({length:count},(_,i)=>{const r=Math.sqrt(hash(i+4))*.49,angle=hash(i+28)*TAU;return{x:.5+Math.cos(angle)*r,y:.5+Math.sin(angle)*r,vx:-Math.sin(angle)*.12,vy:Math.cos(angle)*.12,seed:hash(i+188),life:hash(i+5)};});}
  function drawMachine(t,snap,v){
    const b=layout,m=b.machine,{grid:g,sliders:box}=areas(),gold=css('#e2c866',v.wireOpacity),step=clamp(snap.step||0,0,15);
    text(c,b.small?`SEQ ${String(step+1).padStart(2,'0')} / 16`:'SEQ / 16',m.x,m.y-13,'#e2c866',9);if(!b.small)text(c,`${String(step+1).padStart(2,'0')}   ${api.state.bpm} BPM`,m.x+m.w,m.y-13,'#afa5df',9,'right');
    c.save();c.lineWidth=.65;
    for(let row=0;row<8;row++){const y=g.y+g.h*(row+.5)/8;stroke(c,[[g.x,y],[g.x+g.w,y]],gold,.55);text(c,api.noteName(api.quantize(7-row)),g.x-8,y+3,'#817a56',8,'right');}
    for(let i=0;i<16;i++){
      const x=g.x+g.w*(i+.5)/16,y=g.y+g.h*(7-steps[i]+.5)/8;
      if(i===step&&api.state.playing){c.fillStyle=css('#aa94ff',.08);c.fillRect(g.x+g.w*i/16,g.y,g.w/16,g.h);}
      const glow=api.state.playing&&i===step?1:.3;
      c.shadowBlur=glow*17*v.emission;c.shadowColor='#9582ff';c.strokeStyle=css('#a894ff',enabled[i]?(glow+.35):.15);c.lineWidth=1.3;c.beginPath();c.moveTo(x-8,y);c.lineTo(x+8,y);c.stroke();c.fillStyle=enabled[i]?'#e3dfff':'#50476d';c.beginPath();c.arc(x,y,enabled[i]?2.3:1.2,0,TAU);c.fill();c.shadowBlur=0;
      if(i%4===0)text(c,String(i+1).padStart(2,'0'),x,g.y+g.h+17,'#8c80c5',8,'center');
    }
    const names=['CUTOFF','RESO','TRANSLATE','SPREAD'],keys=['cutoff','resonance','translate','spread'],limits=[[80,12000],[.2,9],[-12,12],[0,19]],z=s();
    for(let i=0;i<4;i++){
      const y=box.y+(i+.5)*box.h/4,value=z[keys[i]],[lo,hi]=limits[i],f=i===0?Math.log(value/lo)/Math.log(hi/lo):(value-lo)/(hi-lo),x=box.x+box.w*.26,end=box.x+box.w*.82;
      text(c,names[i],box.x,y+3,'#d0bb70',b.small?8:9);stroke(c,[[x,y],[end,y]],css('#d0bb70',.37),.8);c.shadowBlur=11*v.emission;c.shadowColor='#9483ff';stroke(c,[[x,y],[lerp(x,end,clamp(f,0,1)),y]],'#a395ff',2);c.shadowBlur=0;c.fillStyle='#eae5ff';c.beginPath();c.arc(lerp(x,end,clamp(f,0,1)),y,2.4,0,TAU);c.fill();
      const valueText=i===0?`${(value/1000).toFixed(1)}k`:i===1?value.toFixed(1):`${value>0?'+':''}${value}`;text(c,valueText,box.x+box.w,y+3,'#b8acdf',9,'right');
    }
    c.restore();
  }
  function drawFlow(t,dt,snap,v){
    const f=layout.field,scale=v.fieldScale;const count=Math.round(clamp(v.streakCount,300,1800));if(particles.length!==count)resetParticles(count);
    text(c,'X PITCH  ·  Y FILTER',f.x,f.y-13,'#d7d4e4',9);text(c,`${contacts.size} CONTACTS`,f.x+f.w,f.y-13,'#847d96',9,'right');
    c.save();c.beginPath();c.rect(f.x,f.y,f.w,f.h);c.clip();
    const active=[...contacts.values()],energy=clamp(snap.rms*5,0,1),timeStep=api.reducedMotion&&!active.length?0:Math.min(dt,.04);
    for(let i=0;i<particles.length;i++){
      const p=particles[i],ox=p.x,oy=p.y,dx=p.x-.5,dy=p.y-.5,r=Math.hypot(dx,dy)+.08;
      let tx=-dy/r*(.07+v.curl*.2),ty=dx/r*(.07+v.curl*.2);
      tx+=(Math.sin(p.y*13+t*.21+p.seed*5)*.013-dx*.02)*v.recovery;ty+=(Math.cos(p.x*11-t*.17+p.seed*7)*.013-dy*.02)*v.recovery;
      for(const touch of active){const qx=(touch.x-f.x)/f.w,qy=(touch.y-f.y)/f.h,px=p.x-qx,py=p.y-qy,d=px*px+py*py+.012,k=v.disturbance*Math.exp(-d*12);tx+=(-py*.18/d+touch.dx*17)*k;ty+=(px*.18/d+touch.dy*17)*k;}
      const response=1-Math.exp(-timeStep*(3+(1-v.inertia)*30));p.vx=lerp(p.vx,tx,response);p.vy=lerp(p.vy,ty,response);p.x+=p.vx*timeStep;p.y+=p.vy*timeStep;
      const radius=Math.hypot(p.x-.5,p.y-.5);if(radius>.51){const ang=Math.atan2(p.y-.5,p.x-.5),rr=.47+hash(i+serial++)*.02;p.x=.5+Math.cos(ang)*rr;p.y=.5+Math.sin(ang)*rr;}
      const x=f.x+f.w*(.5+(p.x-.5)*scale),y=f.y+f.h*(.5+(p.y-.5)*scale),length=v.streakLength*(.5+p.seed);
      const fade=clamp((.52-radius)*9,0,1),alpha=(.23+p.seed*.61+energy*.16)*fade;
      c.strokeStyle=i%13===0?`rgba(177,164,255,${alpha})`:`rgba(242,240,233,${alpha})`;c.lineWidth=.55+p.seed*.65;
      c.beginPath();c.moveTo(x-p.vx*f.w*.025*length,y-p.vy*f.h*.025*length);c.lineTo(x,y);c.stroke();
    }
    for(const touch of active){touch.dx*=Math.exp(-dt*9);touch.dy*=Math.exp(-dt*9);const voice=snap.voices.find(q=>q.id===`swarm-${touch.id}`),level=voice?.level||.45;drawContact(touch.x,touch.y,level,t-touch.started);text(c,api.noteName(touch.midi),touch.x+18,touch.y-16,'#eee9ff',10);}
    for(let i=releases.length-1;i>=0;i--){const q=releases[i],age=t-q.released,voice=snap.voices.find(x=>x.id===`swarm-${q.id}`),level=voice?.level||Math.max(0,1-age/s().release)*.3;if(age>5&&!voice){releases.splice(i,1);continue;}if(level>0)drawContact(q.x,q.y,level,age);}
    c.restore();
    function drawContact(x,y,level,age){c.strokeStyle=css('#b7a3ff',.35+level*.5);c.lineWidth=.8;c.beginPath();c.arc(x,y,8+level*12+Math.sin(age*4)*1.5,0,TAU);c.stroke();c.beginPath();c.moveTo(x-6,y);c.lineTo(x+6,y);c.moveTo(x,y-6);c.lineTo(x,y+6);c.stroke();}
  }
  function drawBridge(t,snap,v){
    const b=layout,y=b.bridgeY,m=b.machine,fx=b.field.x+b.field.w*.83,cx=b.small?b.w*.45:b.w*.43,z=s(),r=Math.max(13,Math.min(32,b.w*.026));
    for(let j=0;j<4;j++){
      const yy=y-8+j*5,c1=css('#d4b85c',v.wireOpacity*(.5-j*.08));c.strokeStyle=c1;c.lineWidth=.8;c.beginPath();c.moveTo(m.x+12,b.small?m.y+m.h:y-60-j*8);c.lineTo(m.x+12,yy);c.bezierCurveTo(cx-r*2,yy,cx-r*2,yy+8,cx,yy+8);c.bezierCurveTo(cx+r*3,yy+8,fx-r,yy,fx,yy);c.stroke();
    }
    for(let j=0;j<2;j++){
      const x=cx+(j-.4)*r*1.7,yy=y+(j===0?-r*.2:r*.4),turn=(api.reducedMotion?0:t*.1)+j*.65+z.translate*.012,extent=j===1?.7+z.spread/24:1;
      c.save();c.translate(x,yy);c.rotate(turn);c.shadowBlur=18*v.emission;c.shadowColor='#9380ff';
      for(let layer=4;layer>=0;layer--){const rr=(r-layer*.9)*extent;c.strokeStyle=css('#a796ff',.16+layer*.09);c.lineWidth=1.3;c.beginPath();for(let i=0;i<=80;i++){const th=i/80*TAU,xx=Math.sign(Math.cos(th))*Math.pow(Math.abs(Math.cos(th)),.5)*rr,yyy=Math.sign(Math.sin(th))*Math.pow(Math.abs(Math.sin(th)),.5)*rr*.73;c[i?'lineTo':'moveTo'](xx+layer*1.2,yyy-layer*1.1);}c.stroke();}c.restore();
    }
    text(c,`TRANSLATE ${z.translate>0?'+':''}${z.translate} st`,cx-r*1.2,y+r*2,'#b6a6ff',8,'center');text(c,`SPREAD ${z.spread} st`,cx+r*2.9,y+r*2,'#c5bed7',8,'center');
    const energy=clamp(snap.rms*8,0,1);c.save();c.shadowBlur=(12+energy*18)*v.emission;c.shadowColor='#d3d3ff';c.strokeStyle='#e1dfff';c.lineWidth=2;c.beginPath();c.ellipse(fx,y,Math.max(25,r*1.25),8+energy*3,-.16,0,TAU);c.stroke();c.restore();text(c,`${(snap.rms||0).toFixed(3)} RMS`,fx,y+34,'#a6a1b4',9,'center');
  }
  function cancel(){for(const id of contacts.keys())api.noteOff(`swarm-${id}`);contacts.clear();roles.clear();releases.length=0;}
  return{
    frame(t,dt){lastT=t;surface.resize();layout=bounds();const v=a(),snap=api.audio.snapshot();c.clearRect(0,0,layout.w,layout.h);c.fillStyle='#08090d';c.fillRect(0,0,layout.w,layout.h);drawMachine(t,snap,v);drawFlow(t,dt,snap,v);drawBridge(t,snap,v);actions.style.left=`${layout.small?layout.w-142:layout.machine.x+12}px`;actions.style.top=`${layout.small?0:layout.machine.y+layout.machine.h+13}px`;},
    onStep(step,when){if(!enabled[step%16])return;const z=s(),note=api.quantize(steps[step%16])+z.translate;api.audio.pulse(`swarm-seq-${step}`,note,{...z,gain:.095,pan:Math.sin(step*.7)*.35},when,60/api.state.bpm*.35);},
    getData(){return{steps:[...steps],enabled:[...enabled]};},
    setData(data){if(Array.isArray(data?.steps)&&data.steps.length===16)steps=data.steps.map(v=>Math.round(clamp(number(v,2),0,7)));if(Array.isArray(data?.enabled)&&data.enabled.length===16)enabled=data.enabled.map(v=>v!==false);},
    cancel,
    destroy(){cancel();dispose?.();seedButton.removeEventListener('click',regenerate);clearButton.removeEventListener('click',clear);actions.remove();surface.destroy();}
  };
}
