import {TAU,clamp,lerp,createSurface,bindPointers,label,line,rgba} from './kit.js';

const range=(key,label,min,max,step,section,description,unit='')=>({key,label,min,max,step,section,description,unit});
export const definition={
  id:'hand',name:'Hand / Machine',batch:3,
  theme:{bg:'#080b18',fg:'#e2e6ff',accent:'#ba9bea',muted:'#939bb7'},
  defaultSound:{waveform:'triangle',attack:.025,decay:.3,sustain:.48,release:1.05,cutoff:4400,resonance:1.4,ratio:2,index:.7,detune:3},
  defaultAppearance:{paper:'#eeeadf',ink:'#514451',electric:'#7196ff',blocks:'#c4a1f0',stipple:1.15,handRelief:.75,tracePersistence:.5,traceGlow:.65,signalScale:8,blockDepth:1,asciiDensity:.7,gridWeight:.7},
  soundControls:[
    {key:'waveform',label:'Carrier waveform',kind:'select',options:[['triangle','Triangle'],['sine','Sine'],['sawtooth','Saw'],['square','Square']],section:'Voice',description:'Oscillator played by either keyboard.'},
    range('cutoff','Low-pass cutoff',120,14000,20,'Voice','Brightness of held keys and the central form.','Hz'),
    range('ratio','Modulator ratio',.25,8,.25,'Voice','Modulator frequency relative to each played note.','×'),
    range('index','Modulation index',0,8,.05,'Voice','Harmonic intensity; drag either upper form to shape it.'),
    range('attack','Attack',.005,2,.005,'Envelope','Time for each key to reach its peak.','s'),
    range('decay','Decay',.03,2,.01,'Envelope','Time from the peak to the held level.','s'),
    range('sustain','Sustain',.05,1,.01,'Envelope','Amplitude while a key remains held.'),
    range('release','Release',.05,5,.05,'Envelope','Tail after a key is released.','s'),
  ],
  appearanceControls:[
    {key:'paper',label:'Paper',kind:'color',section:'Hand',description:'Background of the printed keyboard and hand drawing.'},
    {key:'ink',label:'Printed ink',kind:'color',section:'Hand',description:'Hand contour, stipple and printed key details.'},
    range('stipple','Stipple density',.3,1.8,.05,'Hand','Number of points in the held form and paper keys.'),
    range('handRelief','Form relief',.1,1.5,.05,'Hand','Depth of the dotted form above the illustrated palm.'),
    {key:'electric',label:'Trace colour',kind:'color',section:'Machine',description:'Electrical paths, scope and keyboard outlines.'},
    range('tracePersistence','Trace persistence',0,1,.05,'Machine','Number and opacity of older measured scope traces.'),
    range('traceGlow','Trace bloom',0,1.5,.05,'Machine','Soft glow around blue paths; does not affect the paper side.'),
    range('signalScale','Signal display gain',1,24,.5,'Machine','Display gain for measured scope and ASCII traces; audio level stays unchanged.','×'),
    {key:'blocks',label:'Note blocks',kind:'color',section:'Machine',description:'Colour of the extruded active-note columns.'},
    range('blockDepth','Block depth',.2,1.8,.05,'Machine','Extrusion and height of the note columns.'),
    range('asciiDensity','Key text density',.2,1,.05,'Machine','Sampling density of the waveform characters inside keys.'),
    range('gridWeight','Rule weight',.3,1.6,.05,'Both surfaces','Weight of plot frames, guides and keyboard outlines.','px'),
  ]
};

const seed=i=>{const n=Math.sin(i*127.1+311.7)*43758.5453;return n-Math.floor(n);};
const basePattern=[0,2,4,6,4,3,1,4,0,3,5,7,5,4,2,1];
const hz=midi=>440*Math.pow(2,(midi-69)/12);
const formatHz=v=>v>=1000?(v/1000).toFixed(2)+'k':String(Math.round(v));

export function mount(host,api){
  const surface=createSurface(host,{label:'Two linked keyboards. Play keys; drag the upper forms to change cutoff and modulation. Drag a sequence cell vertically to change its pitch.'});
  const {canvas,ctx:c}=surface, contacts=new Map(), keyIds=new Set();
  let pattern=basePattern.slice(), events=[], elapsed=0, frameCounter=0;
  let traceHistory=[], levels=new Float32Array(8), lastNote=api.quantize(0), shape={x:.5,y:.46};
  function layout(){
    const w=surface.width,h=surface.height,portrait=w<h*.83,gap=portrait?10:12;
    if(portrait){const ph=(h-gap)/2;return [{x:0,y:0,w,h:ph},{x:0,y:ph+gap,w,h:ph}];}
    return [{x:0,y:0,w:(w-gap)/2,h},{x:(w+gap)/2,y:0,w:(w-gap)/2,h}];
  }
  function keyIndex(midi){let best=0,distance=Infinity;for(let i=0;i<8;i++){const d=Math.abs(api.quantize(i)-midi);if(d<distance){best=i;distance=d;}}return best;}
  function region(p){const panes=layout();for(let side=0;side<2;side++){const r=panes[side];if(p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h)return {side,r,x:(p.x-r.x)/r.w,y:(p.y-r.y)/r.h};}return null;}
  function record(midi,when=api.audio.snapshot().time||0){events.unshift({midi,when});events=events.slice(0,32);if(when<=(api.audio.snapshot().time||0))lastNote=midi;}
  function play(contact,p,first=false){
    const q=region(p);if(!q)return;
    const r=layout()[contact.side],x=clamp((p.x-r.x)/r.w,0,1),y=clamp((p.y-r.y)/r.h,0,1);
    let midi;
    if(contact.role==='key')midi=api.quantize(Math.floor(clamp((x-.045)/.91,0,.999)*8));
    else if(contact.role==='step'){
      const note=Math.round(clamp(1-(y-.55)/.15,0,1)*7);pattern[contact.step]=note;midi=api.quantize(note);api.save();
    }else{
      shape={x,y};midi=api.quantize(Math.floor(clamp(x,0,.999)*8));
      const patch={cutoff:Math.round(180*Math.pow(65,x)),index:clamp((.64-y)*12,0,7.5)};
      if(api.setSound)api.setSound(patch);else{Object.assign(api.state.sound,patch);api.audio.configure(api.state.sound);}
    }
    contact.x=x;contact.y=y;
    const options={...api.state.sound,gain:.16,pan:contact.side? .22:-.22};
    if(first){api.noteOn(contact.id,midi,options);record(midi);}
    else{api.noteUpdate(contact.id,midi,options);if(contact.midi!==midi)record(midi);}
    contact.midi=midi;lastNote=midi;
    api.setStatus(`${api.noteName(midi)}  ·  ${hz(midi).toFixed(2)} Hz`);
  }
  const off=bindPointers(canvas,{
    down(p){const q=region(p);if(!q)return false;const role=q.y>.72?'key':q.side===0&&q.y>.575&&q.y<.70?'step':'shape';const contact={id:'hand-'+p.id,side:q.side,role,step:Math.min(15,Math.floor(clamp((q.x-.045)/.91,0,.999)*16))};contacts.set(p.id,contact);play(contact,p,true);},
    move(p){const contact=contacts.get(p.id);if(contact)play(contact,p);},
    up(p){const contact=contacts.get(p.id);if(contact){api.noteOff(contact.id);contacts.delete(p.id);api.save();}},
    cancel(p){const contact=contacts.get(p.id);if(contact){api.noteOff(contact.id);contacts.delete(p.id);}}
  });
  const keyMap='asdfghjk';
  const down=e=>{const index=keyMap.indexOf(e.key?.toLowerCase());if(index<0||e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;e.preventDefault();const id='hand-keyboard-'+index;keyIds.add(id);const midi=api.quantize(index);api.noteOn(id,midi,{gain:.16});record(midi);};
  const up=e=>{const index=keyMap.indexOf(e.key?.toLowerCase());if(index<0)return;const id='hand-keyboard-'+index;api.noteOff(id);keyIds.delete(id);};
  canvas.addEventListener('keydown',down);canvas.addEventListener('keyup',up);

  function drawHand(r,v,t,energy){
    c.save();c.beginPath();c.rect(r.x,r.y,r.w,r.h);c.clip();c.fillStyle=v.paper;c.fillRect(r.x,r.y,r.w,r.h);
    const ink=v.ink, pad=r.w*.045, cx=r.x+r.w*.52,cy=r.y+r.h*.285,rad=Math.min(r.w*.27,r.h*.235),weight=v.gridWeight;
    c.fillStyle=rgba(ink,.045);for(let i=0;i<650;i++)c.fillRect(r.x+seed(i)*r.w,r.y+seed(i+991)*r.h,1,1);
    label(c,'HAND  /  KEY VELOCITY',r.x+pad,r.y+19,rgba(ink,.7),9);
    label(c,api.noteName(lastNote),r.x+r.w-pad,r.y+19,ink,12,'right');
    c.strokeStyle=rgba(ink,.45);c.lineWidth=weight;c.beginPath();c.ellipse(cx,cy,rad,rad*.73,-.17,0,TAU);c.stroke();
    const count=Math.floor(3600*v.stipple);
    c.fillStyle=rgba(ink,.82);
    for(let i=0;i<count;i++){
      const u=seed(i+31)*TAU, radius=Math.sqrt(seed(i+1951)),x=Math.cos(u)*radius,y=Math.sin(u)*radius;
      const dome=Math.sqrt(Math.max(0,1-radius*radius));
      const wave=Math.sin(u*3+t*.38+radius*8)*.04+energy*Math.sin(u*5+t*3)*.12;
      const px=cx+x*rad*(1+wave),py=cy+y*rad*.66-dome*rad*.32*v.handRelief+(shape.y-.4)*rad*.12;
      const shade=.5+.5*Math.sin(u*2+radius*6);const d=(.55+seed(i+431)*.95+dome*shade*.55)*(1+energy*.55);c.fillRect(px,py,d,d);
    }
    for(let j=0;j<5;j++)line(c,[[cx+rad*.7,cy+rad*(-.3+j*.22)],[r.x+r.w-pad,cy+rad*(-.3+j*.22)]],rgba(ink,.23),weight*.65);
    // The palm and five fingers are an engraved outline, drawn over the field.
    c.save();c.translate(cx-rad*.69,cy+rad*.37);c.scale(rad/100,rad/100);c.strokeStyle=ink;c.fillStyle=v.paper;c.lineWidth=1.1;
    c.beginPath();c.moveTo(0,38);c.bezierCurveTo(3,21,10,10,17,7);c.bezierCurveTo(26,2,34,4,32,14);c.lineTo(29,31);c.lineTo(33,3);c.bezierCurveTo(34,-8,47,-9,48,3);c.lineTo(48,29);c.lineTo(50,-4);c.bezierCurveTo(51,-16,66,-15,67,-3);c.lineTo(66,30);c.lineTo(70,1);c.bezierCurveTo(72,-12,85,-8,85,4);c.lineTo(83,36);c.lineTo(89,15);c.bezierCurveTo(92,4,104,8,103,21);c.lineTo(98,59);c.bezierCurveTo(94,85,74,91,50,86);c.lineTo(15,74);c.bezierCurveTo(8,65,2,53,0,38);c.fill();c.stroke();
    for(let j=0;j<4;j++){c.beginPath();c.moveTo(34+j*16,34);c.lineTo(33+j*16,55);c.stroke();}
    c.beginPath();c.moveTo(17,48);c.bezierCurveTo(33,54,45,68,69,68);c.stroke();c.restore();
    const sound=api.state.sound;
    label(c,'FC '+formatHz(sound.cutoff)+' Hz',r.x+pad,r.y+r.h*.53,rgba(ink,.8),9);
    label(c,'IDX '+sound.index.toFixed(2),r.x+r.w-pad,r.y+r.h*.53,rgba(ink,.8),9,'right');
    const sy=r.y+r.h*.585,sw=(r.w-pad*2)/16,sh=r.h*.095,step=api.audio.snapshot().step??0;
    for(let i=0;i<16;i++){
      const active=api.state.playing&&i===step%16;
      c.strokeStyle=rgba(ink,active?.8:.22);c.lineWidth=weight;c.strokeRect(r.x+pad+i*sw,sy,sw-2,sh);
      c.fillStyle=rgba(ink,active?.35:.13);const bh=(pattern[i]+1)/8*(sh-8);c.fillRect(r.x+pad+i*sw+3,sy+sh-bh-3,sw-8,bh);
      if(r.w>360)label(c,String(i+1).padStart(2,'0'),r.x+pad+(i+.5)*sw,sy+sh+11,rgba(ink,.55),7,'center');
    }
    drawKeyboard(r,false,v,t);c.restore();
  }
  function drawKeyboard(r,machine,v,t){
    const x=r.x+r.w*.045,y=r.y+r.h*.735,w=r.w*.91,h=r.h*.235,kw=w/8,ink=machine?v.electric:v.ink;
    const snap=api.audio.snapshot(),wave=snap.waveform||[];
    for(let i=0;i<8;i++){
      const level=levels[i];c.fillStyle=machine?rgba(ink,.025+level*.17):rgba(v.ink,.025+level*.1);c.fillRect(x+i*kw,y,kw-2,h);
      c.strokeStyle=rgba(ink,.4+level*.4);c.lineWidth=v.gridWeight;c.strokeRect(x+i*kw,y,kw-2,h);
      const black=[1,2,4,5,6].includes(i);
      if(!machine&&black){
        const bx=x+i*kw-kw*.17,bw=kw*.34,bh=h*.6;c.fillStyle=rgba(ink,.93);c.fillRect(bx,y,bw,bh);
        c.fillStyle=rgba(v.paper,.55);for(let k=0;k<Math.floor(60*v.stipple);k++)c.fillRect(bx+seed(i*100+k)*bw,y+seed(k*17+i)*bh,.7,.7);
      }
      if(machine){
        c.save();c.beginPath();c.rect(x+i*kw+3,y+3,kw-8,h-19);c.clip();
        const chars=' .:;!17ZX#', rows=Math.floor((h-20)/(8.5+(1-v.asciiDensity)*8)),columns=Math.max(2,Math.floor(kw/7));
        c.font='7px ui-monospace, monospace';c.fillStyle=rgba('#d7d9f6',.18+level*.7);
        for(let row=0;row<rows;row++){let text='';for(let col=0;col<columns;col++){const n=wave.length?Math.abs(wave[(row*columns+col+i*17)%wave.length]):0;text+=chars[Math.min(chars.length-1,Math.floor(Math.sqrt(clamp(n*v.signalScale))*8+level))];}c.fillText(text,x+i*kw+4,y+10+row*9);}
        c.restore();
      }else if(!black){c.fillStyle=rgba(ink,.16);for(let k=0;k<Math.floor(35*v.stipple);k++)c.fillRect(x+i*kw+seed(k*7+i)*kw,y+seed(k*5+i+500)*h,.7,.7);}
      if(level>.01){c.fillStyle=machine?v.blocks:ink;c.fillRect(x+i*kw+1,y+h-4,(kw-4)*level,2);}
      label(c,api.noteName(api.quantize(i)),x+(i+.5)*kw,y+h-10,machine?'#c8d1f1':ink,Math.max(7,Math.min(10,kw*.2)),'center');
    }
  }
  function drawMachine(r,v,t,energy,snap){
    c.save();c.beginPath();c.rect(r.x,r.y,r.w,r.h);c.clip();c.fillStyle='#070b18';c.fillRect(r.x,r.y,r.w,r.h);
    const pad=r.w*.045,cx=r.x+r.w*.41,cy=r.y+r.h*.275,rad=Math.min(r.w*.265,r.h*.24),electric=v.electric;
    const glow=c.createRadialGradient(cx,cy,rad*.3,cx,cy,rad*2.4);glow.addColorStop(0,rgba(electric,.11));glow.addColorStop(1,rgba(electric,0));c.fillStyle=glow;c.fillRect(r.x,r.y,r.w,r.h*.62);
    // Field contours are derived from oscillator phase and the live spectrum.
    c.save();c.lineWidth=.6;c.shadowBlur=v.traceGlow*8;c.shadowColor=electric;
    const frequency=snap.frequency||[];
    for(let j=0;j<16;j++){
      const pts=[];for(let i=0;i<70;i++){const px=r.x+i/69*r.w,base=r.y+r.h*.06+j*r.h*.034;const a=frequency.length?(frequency[(i*2+j)%frequency.length]||0):0;const dy=Math.sin(i*.22+j*.45+t*.12)*7+Math.sin(i*.49-j*.23)*3+a*18;pts.push([px,base+dy]);}line(c,pts,rgba(electric,.07+energy*.08),.6);
    }
    for(let j=0;j<24;j++){
      const a=j/24*TAU,pts=[],bin=frequency.length?(frequency[Math.floor(j/24*frequency.length*.6)]||0):0;
      for(let k=0;k<24;k++){const f=k/23,rr=rad*(1.12+f*1.4),bend=Math.sin(f*11+j*.3)*(.016+bin*.1)*f;pts.push([cx+Math.cos(a+bend)*rr,cy+Math.sin(a+bend)*rr*.88]);}
      line(c,pts,rgba(electric,.045+energy*.065+bin*.12),.6);
    }
    c.restore();
    label(c,'MACHINE  /  VOICE STATE',r.x+pad,r.y+19,rgba('#cbd7ff',.8),9);
    label(c,`${hz(lastNote).toFixed(2)} Hz`,r.x+r.w-pad,r.y+19,'#dce4ff',11,'right');
    c.save();c.shadowBlur=v.traceGlow*12;c.shadowColor=electric;
    c.strokeStyle=rgba(electric,.72);c.lineWidth=2;c.beginPath();c.ellipse(cx,cy,rad,rad*.88,-.15,0,TAU);c.stroke();
    c.lineWidth=.65;c.strokeStyle=rgba(electric,.33);for(const f of [.88,1.055]){c.beginPath();c.ellipse(cx,cy,rad*f,rad*.88*f,-.15,0,TAU);c.stroke();}
    c.restore();
    for(let i=0;i<40;i++){const a=i/40*TAU,rr=i%5===0?1.11:1.075;line(c,[[cx+Math.cos(a)*rad*1.02,cy+Math.sin(a)*rad*.9],[cx+Math.cos(a)*rad*rr,cy+Math.sin(a)*rad*.88*rr]],rgba(electric,i%5===0?.65:.25),.7);}
    const waves=traceHistory.slice(-Math.max(1,Math.floor(1+v.tracePersistence*8)));
    waves.forEach((wave,j)=>{
      const pts=[],fade=(j+1)/waves.length;
      for(let i=0;i<220;i++){const a=i/219*TAU*2,amp=wave.length?clamp(wave[Math.floor(i/220*wave.length)]*v.signalScale,-1,1):0;const radius=rad*(.31+amp*.34);pts.push([cx+Math.cos(a)*radius+Math.sin(a*3+t*.15)*rad*.11,cy+Math.sin(a*1.5)*radius*.88]);}
      line(c,pts,rgba(j===waves.length-1?'#e8f1dc':electric,.08+fade*.48),j===waves.length-1?.9:.55);
    });
    if(!waves.length){const pts=[];for(let i=0;i<180;i++){const a=i/179*TAU;pts.push([cx+Math.cos(a*2)*rad*.27,cy+Math.sin(a*3)*rad*.22]);}line(c,pts,rgba(electric,.3),.7);}
    for(const contact of contacts.values()){if(contact.role!=='shape')continue;const a=(contact.x-.5)*TAU;const px=cx+Math.cos(a)*rad*.6,py=cy+Math.sin(a)*rad*.45;c.strokeStyle='#c3f5a4';c.lineWidth=1.3;c.beginPath();c.arc(px,py,5,0,TAU);c.stroke();line(c,[[cx,cy],[px,py]],rgba('#c3f5a4',.6),.7);}
    const bx=r.x+r.w*.78,by=r.y+r.h*.105,bw=r.w*.037,bh=r.h*.29;
    const params=[['A',api.state.sound.attack/2],['D',api.state.sound.decay/2],['S',api.state.sound.sustain],['R',api.state.sound.release/5]];
    params.forEach(([name,val],i)=>{const xx=bx+i*bw*1.23;c.strokeStyle=rgba(electric,.4);c.lineWidth=v.gridWeight;c.strokeRect(xx,by,bw,bh);const filled=clamp(val,.035,1)*bh;c.fillStyle=rgba('#b9e68a',.45+energy*.45);c.fillRect(xx+2,by+bh-filled,bw-4,filled);for(let yy=by+3;yy<by+bh;yy+=4)line(c,[[xx,yy],[xx+bw,yy]],rgba('#070b18',.55),.6);label(c,name,xx+bw/2,by+bh+12,'#c9d4ed',8,'center');});
    const ly=r.y+r.h*.505,lh=r.h*.073;
    c.strokeStyle=rgba(electric,.32);c.lineWidth=v.gridWeight;c.strokeRect(r.x+pad,ly,r.w-pad*2,lh);
    const time=snap.time||0, recent=events.filter(e=>e.when<=time).slice(0,3);
    for(let i=0;i<3;i++){const e=recent[i],text=e?`${i===0?'NOW ':'PAST'} ${api.noteName(e.midi).padEnd(3)} ${e.when.toFixed(3).padStart(7)}s`:'—';label(c,text,r.x+pad+6,ly+11+i*10,rgba('#d4dcf7',.8-i*.18),7.5);}
    const wave=snap.waveform||[],pts=[];for(let i=0;i<100;i++){const value=wave.length?clamp(wave[Math.floor(i/100*wave.length)]*v.signalScale,-1,1):0;pts.push([r.x+r.w*.48+i/99*r.w*.45,ly+lh/2+value*lh*.38]);}line(c,pts,rgba('#b8e8d2',.8),.8);
    const ky=r.y+r.h*.704,kw=r.w*.91/8,kx=r.x+pad;
    for(let i=0;i<8;i++){
      const hh=(.06+levels[i]*.78)*r.h*.13*v.blockDepth,xx=kx+i*kw+kw*.18,ww=kw*.48,depth=Math.min(10,ww*.27)*v.blockDepth,yy=ky-hh;
      c.fillStyle=rgba(v.blocks,.4+levels[i]*.55);c.fillRect(xx,yy,ww,hh);c.fillStyle=rgba(v.blocks,.9);c.beginPath();c.moveTo(xx,yy);c.lineTo(xx+depth,yy-depth);c.lineTo(xx+ww+depth,yy-depth);c.lineTo(xx+ww,yy);c.closePath();c.fill();c.fillStyle=rgba(v.blocks,.28);c.beginPath();c.moveTo(xx+ww,yy);c.lineTo(xx+ww+depth,yy-depth);c.lineTo(xx+ww+depth,ky-depth);c.lineTo(xx+ww,ky);c.closePath();c.fill();
      line(c,[[xx,ky+3],[xx+ww+depth,ky+3]],rgba(electric,.3),.6);
    }
    drawKeyboard(r,true,v,t);c.restore();
  }
  function cancel(){for(const p of contacts.values())api.noteOff(p.id);for(const id of keyIds)api.noteOff(id);contacts.clear();keyIds.clear();}
  return {
    frame(t,dt){
      elapsed=t;surface.resize();const w=surface.width,h=surface.height;if(!w||!h)return;
      const v={...definition.defaultAppearance,...api.state.appearance},snap=api.audio.snapshot(),target=new Float32Array(8);
      const latest=(snap.voices||[]).reduce((a,b)=>!a||(b.started||0)>(a.started||0)?b:a,null);if(latest)lastNote=latest.midi;
      for(const voice of snap.voices||[]){const i=keyIndex(voice.midi);target[i]=Math.max(target[i],Math.sqrt(clamp((voice.level||0)*4)));}
      for(let i=0;i<8;i++)levels[i]=lerp(levels[i],target[i],1-Math.exp(-dt*14));
      if(++frameCounter%3===0){traceHistory.push(Array.from(snap.waveform||[]).filter((_,i)=>i%4===0));if(traceHistory.length>9)traceHistory.shift();}
      const energy=clamp((snap.rms||0)*4+Math.max(...levels)*.3,0,1);c.clearRect(0,0,w,h);const panes=layout();drawHand(panes[0],v,t,energy);drawMachine(panes[1],v,t,energy,snap);
    },
    onStep(step,when){const midi=api.quantize(pattern[step%16]);api.audio.pulse('hand-sequence-'+step,midi,{...api.state.sound,gain:.15,pan:step%2?.13:-.13},when,60/api.state.bpm*.32);record(midi,when);},
    cancel,
    getData(){return {pattern:pattern.slice()};},
    setData(data){if(Array.isArray(data?.pattern)&&data.pattern.length===16)pattern=data.pattern.map((v,i)=>Number.isFinite(v)?Math.round(clamp(v,0,7)):basePattern[i]);},
    destroy(){cancel();off();canvas.removeEventListener('keydown',down);canvas.removeEventListener('keyup',up);surface.destroy();}
  };
}
