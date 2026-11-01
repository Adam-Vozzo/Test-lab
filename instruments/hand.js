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
  const reliefPoints=Array.from({length:20000},(_,i)=>{const z=1-2*(i+.5)/20000,r=Math.sqrt(1-z*z),a=i*2.3999632297;return{x:Math.cos(a)*r,y:Math.sin(a)*r,z,a,grain:seed(i+729)};});
  const reliefCanvas=document.createElement('canvas'),reliefContext=reliefCanvas.getContext('2d',{alpha:true});let reliefKey='';
  const cloudBuckets=Array.from({length:6},()=>[]);for(let i=0;i<5200;i++){const p=reliefPoints[Math.floor(i/5200*20000)];cloudBuckets[Math.min(5,Math.floor((p.z+1)*3))].push({...p,index:i});}
  let pattern=basePattern.slice(), events=[], elapsed=0, frameCounter=0,gestureSerial=0;
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
    if(contact.role==='knob'){
      if(!first){const specs={cutoff:[120,14000],index:[0,8],ratio:[.25,8],release:[.05,5]},[min,max]=specs[contact.key],delta=(contact.startY-p.y)/(r.h*.26);const value=contact.key==='cutoff'?clamp(contact.startValue*Math.pow(100,delta),min,max):clamp(contact.startValue+delta*(max-min),min,max);if(api.setSound)api.setSound({[contact.key]:value});else{api.state.sound[contact.key]=value;api.audio.configure(api.state.sound);}}
      api.setStatus(`${contact.key.toUpperCase()}  ${api.state.sound[contact.key].toFixed(contact.key==='cutoff'?0:2)}`);return;
    }
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
    down(p){const q=region(p);if(!q)return false;const knob=q.side===0&&q.x<.19&&q.y>.08&&q.y<.49;const role=knob?'knob':q.y>.72?'key':q.side===0&&q.y>.575&&q.y<.70?'step':'shape';const key=['cutoff','index','ratio','release'][Math.min(3,Math.floor(clamp((q.y-.085)/.405,0,.999)*4))];const contact={id:'hand-'+p.id+'-'+(++gestureSerial),side:q.side,role,key,startY:p.y,startValue:api.state.sound[key],step:Math.min(15,Math.floor(clamp((q.x-.045)/.91,0,.999)*16))};contacts.set(p.id,contact);play(contact,p,true);},
    move(p){const contact=contacts.get(p.id);if(contact)play(contact,p);},
    up(p){const contact=contacts.get(p.id);if(contact){if(contact.role!=='knob')api.noteOff(contact.id);contacts.delete(p.id);api.save();}},
    cancel(p){const contact=contacts.get(p.id);if(contact){if(contact.role!=='knob')api.noteOff(contact.id);contacts.delete(p.id);}}
  });

  function drawPrintedRelief(c,r,v){
    const ink=v.ink,pad=r.w*.045,cx=r.w*.59,cy=r.h*.275,rad=Math.min(r.w*.29,r.h*.25),weight=v.gridWeight,energy=0,t=0;
    c.strokeStyle=rgba(ink,.45);c.lineWidth=weight*.7;c.beginPath();c.ellipse(cx,cy,rad*1.02,rad*.84,-.17,0,TAU);c.stroke();
    const count=Math.floor(Math.min(20000,14000*v.stipple));
    c.fillStyle=rgba(ink,.88);
    for(let i=0;i<count;i++){
      const p=reliefPoints[Math.floor(i/count*reliefPoints.length)],depth=p.y*.68+p.z*.74;if(depth<-.025)continue;
      const fold=Math.sin(p.a*3+p.z*5)*.065*v.handRelief,indent=Math.exp(-((p.x-.1)**2+(p.y-.45)**2)*8)*.26*v.handRelief;
      const wave=energy*Math.sin(p.a*4+t*2)*.035,xx=p.x*(1+fold+wave),zz=p.z-indent;
      const px=cx+xx*rad,py=cy+(p.y*.62-zz*.61)*rad+(shape.y-.4)*rad*.055;
      const shade=clamp(.48-p.x*.3+p.y*.22-p.z*.16,.1,.92),d=(.33+p.grain*.55+shade*.95)*(1+energy*.24);c.fillRect(px,py,d,d);
    }
    // A recessed well and engraved fold give the stipple relief a continuous annular volume.
    const wellX=cx-rad*.08,wellY=cy+rad*.06,wellR=rad*(.22+v.handRelief*.035);
    c.fillStyle=v.paper;c.beginPath();c.ellipse(wellX,wellY,wellR,wellR*.79,-.18,0,TAU);c.fill();
    c.fillStyle=rgba(ink,.7);for(let i=0;i<1150*v.stipple;i++){const a=seed(i+1800)*TAU,rr=wellR*(1+seed(i+5000)*.19);c.fillRect(wellX+Math.cos(a)*rr,wellY+Math.sin(a)*rr*.79,.65,.65);}
    for(let j=0;j<5;j++)line(c,[[cx+rad*(.01+j*.014),cy-rad*.28],[cx+rad*(.43+j*.012),cy-rad*.53]],rgba(ink,.55-j*.07),.65);
    for(let j=0;j<5;j++)line(c,[[cx+rad*.7,cy+rad*(-.3+j*.22)],[r.x+r.w-pad,cy+rad*(-.3+j*.22)]],rgba(ink,.23),weight*.65);
    // The palm and five fingers are an engraved outline, drawn over the field.
    c.save();c.translate(cx-rad*.76,cy+rad*.22);c.scale(rad/100,rad/100);c.strokeStyle=ink;c.fillStyle=v.paper;c.lineWidth=.65;
    c.beginPath();c.moveTo(0,38);c.bezierCurveTo(3,21,10,10,17,7);c.bezierCurveTo(26,2,34,4,32,14);c.lineTo(29,31);c.lineTo(33,3);c.bezierCurveTo(34,-8,47,-9,48,3);c.lineTo(48,29);c.lineTo(50,-4);c.bezierCurveTo(51,-16,66,-15,67,-3);c.lineTo(66,30);c.lineTo(70,1);c.bezierCurveTo(72,-12,85,-8,85,4);c.lineTo(83,36);c.lineTo(89,15);c.bezierCurveTo(92,4,104,8,103,21);c.lineTo(98,59);c.bezierCurveTo(94,85,74,91,50,86);c.lineTo(15,74);c.bezierCurveTo(8,65,2,53,0,38);c.fill();c.stroke();
    for(let j=0;j<4;j++){c.beginPath();c.moveTo(34+j*16,34);c.lineTo(33+j*16,55);c.stroke();}
    for(const [xx,yy]of [[38,2],[55,-5],[74,3],[91,19]]){c.beginPath();c.moveTo(xx,yy+6);c.bezierCurveTo(xx-2,yy-3,xx+7,yy-4,xx+7,yy+6);c.stroke();}
    c.lineWidth=.35;for(let j=0;j<6;j++){c.beginPath();c.moveTo(25+j*7,62+j*.8);c.lineTo(27+j*7,70+j*.8);c.stroke();}
    c.beginPath();c.moveTo(17,48);c.bezierCurveTo(33,54,45,68,69,68);c.stroke();c.restore();
  }
  function drawHand(r,v,t,energy){
    c.save();c.beginPath();c.rect(r.x,r.y,r.w,r.h);c.clip();c.fillStyle=v.paper;c.fillRect(r.x,r.y,r.w,r.h);
    const ink=v.ink, pad=r.w*.045, cx=r.x+r.w*.59,cy=r.y+r.h*.275,rad=Math.min(r.w*.29,r.h*.25),weight=v.gridWeight;
    c.fillStyle=rgba(ink,.045);for(let i=0;i<650;i++)c.fillRect(r.x+seed(i)*r.w,r.y+seed(i+991)*r.h,1,1);
    label(c,'HAND  /  KEY VELOCITY',r.x+pad,r.y+19,rgba(ink,.7),9);
    label(c,api.noteName(lastNote),r.x+r.w-pad,r.y+19,ink,12,'right');
    const cacheKey=[r.w,r.h,surface.dpr,v.paper,v.ink,v.stipple,v.handRelief,v.gridWeight,shape.y].join('|');
    if(cacheKey!==reliefKey){
      reliefKey=cacheKey;const d=Math.min(surface.dpr,1.5);reliefCanvas.width=Math.ceil(r.w*d);reliefCanvas.height=Math.ceil(r.h*.57*d);reliefContext.setTransform(d,0,0,d,0,0);
      drawPrintedRelief(reliefContext,{...r,x:0,y:0},v);
    }
    c.drawImage(reliefCanvas,r.x,r.y,r.w,r.h*.57);
    const sound=api.state.sound;
    for(let j=0;j<4;j++){
      const key=['cutoff','index','ratio','release'][j],xx=r.x+r.w*.095,yy=r.y+r.h*(.135+j*.102),rr=Math.min(15,r.w*.028),value=sound[key],fraction=key==='cutoff'?Math.log(value/120)/Math.log(14000/120):key==='index'?value/8:key==='ratio'?value/8:value/5;
      c.strokeStyle=rgba(ink,.7);c.lineWidth=.8;c.beginPath();c.arc(xx,yy,rr,0,TAU);c.stroke();const angle=-Math.PI*.8+clamp(fraction)*Math.PI*1.6;line(c,[[xx,yy],[xx+Math.sin(angle)*rr*.7,yy-Math.cos(angle)*rr*.7]],ink,1);
      label(c,key==='cutoff'?'CUTOFF':key.toUpperCase(),xx,yy+rr+9,rgba(ink,.75),7,'center');
    }
    label(c,'FC '+formatHz(sound.cutoff)+' Hz',r.x+pad,r.y+r.h*.53,rgba(ink,.8),9);
    label(c,'IDX '+sound.index.toFixed(2),r.x+r.w-pad,r.y+r.h*.53,rgba(ink,.8),9,'right');
    const sy=r.y+r.h*.585,sw=(r.w-pad*2)/16,sh=r.h*.095,step=api.audio.snapshot().step??0;
    for(let i=0;i<16;i++){
      const active=api.state.playing&&i===step%16;
      const xx=r.x+pad+(i+.5)*sw,yy=sy+(1-pattern[i]/7)*sh*.22;c.fillStyle=rgba(ink,active?.9:.4);c.beginPath();c.arc(xx,yy,active?2:1,0,TAU);c.fill();
      line(c,[[xx,sy+sh*.24],[xx,yy]],rgba(ink,.16),.6);
    }
    const kw=(r.w-pad*2)/8;
    for(let i=0;i<8;i++){
      const xx=r.x+pad+(i+.5)*kw,yy=sy+sh*.9,ww=kw*.4,hh=sh*(.2+levels[i]*.55),dd=ww*.3;
      c.lineWidth=weight*.8;c.strokeStyle=rgba(ink,.52);c.strokeRect(xx-ww/2,yy-hh,ww,hh);line(c,[[xx-ww/2,yy-hh],[xx-ww/2+dd,yy-hh-dd],[xx+ww/2+dd,yy-hh-dd],[xx+ww/2,yy-hh]],rgba(ink,.66),weight*.8);line(c,[[xx+ww/2,yy],[xx+ww/2+dd,yy-dd],[xx+ww/2+dd,yy-hh-dd]],rgba(ink,.66),weight*.8);
      label(c,api.noteName(api.quantize(i)),xx,sy+sh+11,rgba(ink,.55),7,'center');
    }
    drawKeyboard(r,false,v,t);c.restore();
  }
  function drawKeyboard(r,machine,v,t){
    const x=r.x+r.w*.045,y=r.y+r.h*.735,w=r.w*.91,h=r.h*.235,kw=w/8,ink=machine?v.electric:v.ink;
    const snap=api.audio.snapshot(),wave=snap.waveform||[];
    for(let i=0;i<8;i++){
      const level=levels[i],gated=(snap.voices||[]).some(voice=>voice.gate&&keyIndex(voice.midi)===i);c.fillStyle=machine?rgba(ink,.025+level*.17):rgba(v.ink,.025+level*.1);c.fillRect(x+i*kw,y,kw-2,h);
      c.strokeStyle=machine&&gated?rgba('#b8ec81',.8):rgba(ink,.4+level*.4);c.lineWidth=v.gridWeight;c.strokeRect(x+i*kw,y,kw-2,h);
      const black=[1,2,4,5,6].includes(i);
      if(!machine&&black){
        const bx=x+i*kw-kw*.17,bw=kw*.34,bh=h*.6;c.fillStyle=rgba(ink,.93);c.fillRect(bx,y,bw,bh);
        c.fillStyle=rgba(v.paper,.55);for(let k=0;k<Math.floor(230*v.stipple);k++)c.fillRect(bx+seed(i*100+k)*bw,y+seed(k*17+i)*bh,.7,.7);
      }
      if(machine){
        c.save();c.beginPath();c.rect(x+i*kw+3,y+3,kw-8,h-19);c.clip();
        const chars='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ@#',font=Math.max(7,Math.min(10,kw*.15)),rows=Math.floor((h-20)/(font+1.2+(1-v.asciiDensity)*3)),columns=Math.max(2,Math.floor((kw-8)/(font*.61)));
        let peak=.008;for(let k=0;k<wave.length;k++)peak=Math.max(peak,Math.abs(wave[k]));
        const signal=peak>.009,displayGain=Math.min(v.signalScale/8,2);c.font=`600 ${font}px ui-monospace, monospace`;
        for(let row=0;row<rows;row++){
          let text='',strength=0;
          for(let col=0;col<columns;col++){
            const pos=wave.length?(row*43+col*71+i*97)%wave.length:0,sample=signal?clamp((wave[pos]||0)/peak*displayGain,-1,1):0,derivative=signal?clamp(((wave[(pos+17)%wave.length]||0)-(wave[pos]||0))/peak,-1,1):0;
            strength+=Math.abs(sample);text+=signal?chars[Math.min(chars.length-1,Math.floor(clamp((sample+1)*.42+(derivative+1)*.08,0,.999)*chars.length))]:' ';
          }
          const band=strength/columns;
          if(!signal)text=[api.noteName(api.quantize(i)),hz(api.quantize(i)).toFixed(2),'A'+api.state.sound.attack.toFixed(3),'R'+api.state.sound.release.toFixed(2),'M'+api.quantize(i)][row%5].padEnd(columns,' ').slice(0,columns);
          c.fillStyle=gated&&band>.4?rgba('#d2fa87',.78+level*.2):rgba('#e4e6f9',signal?.49+band*.35+level*.15:.28);
          if(gated&&band>.42){c.fillStyle=rgba('#96c75a',.13+level*.1);c.fillRect(x+i*kw+3,y+3+row*(font+1.2),kw-8,font+1);c.fillStyle='#d8fa9d';}
          c.fillText(text,x+i*kw+4,y+font+3+row*(font+1.2));
        }
        c.restore();
      }else if(!black){c.fillStyle=rgba(ink,.22);for(let k=0;k<Math.floor(280*v.stipple);k++)c.fillRect(x+i*kw+seed(k*7+i)*kw,y+seed(k*5+i+500)*h,.7,.7);}
      if(level>.01){c.fillStyle=machine?v.blocks:ink;c.fillRect(x+i*kw+1,y+h-4,(kw-4)*level,2);}
      label(c,api.noteName(api.quantize(i)),x+(i+.5)*kw,y+h-10,machine?'#c8d1f1':ink,Math.max(7,Math.min(10,kw*.2)),'center');
    }
  }
  function drawMachine(r,v,t,energy,snap){
    c.save();c.beginPath();c.rect(r.x,r.y,r.w,r.h);c.clip();c.fillStyle='#070b18';c.fillRect(r.x,r.y,r.w,r.h);
    const pad=r.w*.045,cx=r.x+r.w*.41,cy=r.y+r.h*.27,rad=Math.min(r.w*.255,r.h*.225),electric=v.electric;
    const glow=c.createRadialGradient(cx,cy,rad*.3,cx,cy,rad*2.4);glow.addColorStop(0,rgba(electric,.11));glow.addColorStop(1,rgba(electric,0));c.fillStyle=glow;c.fillRect(r.x,r.y,r.w,r.h*.62);
    // Bounded radial light sheets and electrical paths follow the measured spectrum.
    const frequency=snap.frequency||[],scopeWave=snap.waveform||[];
    c.save();c.beginPath();c.rect(r.x,r.y+26,r.w,r.h*.69-26);c.clip();
    for(let fan=0;fan<11;fan++){
      const bin=frequency.length?(frequency[Math.floor(fan/11*frequency.length*.6)]||0):0,neighbour=frequency.length?(frequency[Math.floor((fan+1)/12*frequency.length*.6)]||0):0,angle=fan/11*TAU+.14*Math.sin(fan*2.1)+(bin-neighbour)*.2,spread=.07+.07*(.5+.5*Math.sin(fan*1.7))+bin*.1,inner=rad*(1.01+(fan%3)*.025),outer=rad*(1.72+.35*Math.sin(fan*1.3)+bin*.65);
      const sheet=c.createRadialGradient(cx,cy,inner,cx,cy,outer);sheet.addColorStop(0,rgba('#5c80ff',.03));sheet.addColorStop(.5,rgba('#4771ff',.22+v.traceGlow*.15+bin*.2));sheet.addColorStop(1,rgba(electric,0));
      c.save();c.shadowColor='#385bdd';c.shadowBlur=6+v.traceGlow*7;c.fillStyle=sheet;c.beginPath();c.moveTo(cx+Math.cos(angle-spread)*inner,cy+Math.sin(angle-spread)*inner*.88);c.lineTo(cx+Math.cos(angle-spread*1.35)*outer,cy+Math.sin(angle-spread*1.35)*outer*.88);c.lineTo(cx+Math.cos(angle+spread*1.35)*outer,cy+Math.sin(angle+spread*1.35)*outer*.88);c.lineTo(cx+Math.cos(angle+spread)*inner,cy+Math.sin(angle+spread)*inner*.88);c.closePath();c.fill();c.restore();
      for(let j=0;j<22;j++){const a=angle-spread+j/21*spread*2,pts=[];for(let k=0;k<22;k++){const f=k/21,rr=inner+(outer-inner)*f,amp=scopeWave.length?(scopeWave[(k*13+fan*37)%scopeWave.length]||0)*v.signalScale:0,bend=Math.sin(f*4+fan)*.026+amp*.025*f;pts.push([cx+Math.cos(a+bend)*rr,cy+Math.sin(a+bend)*rr*.88]);}line(c,pts,rgba(electric,.045+bin*.08),.65);}
    }
    c.shadowBlur=v.traceGlow*4;c.shadowColor=electric;
    for(let j=0;j<7;j++){
      const pts=[];for(let i=0;i<95;i++){const px=r.x+i/94*r.w,base=r.y+r.h*(.055+j*.104),a=frequency.length?(frequency[(i+j*11)%frequency.length]||0):0,w=scopeWave.length?(scopeWave[(i*11+j*71)%scopeWave.length]||0)*v.signalScale:0;pts.push([px,base+Math.sin(i*.19+j)*8+Math.sin(i*.43+j*2)*4+w*7+a*13]);}line(c,pts,rgba('#9bbcff',.22+energy*.2),.9);
    }
    c.restore();
    label(c,'MACHINE  /  VOICE STATE',r.x+pad,r.y+19,rgba('#cbd7ff',.8),9);
    label(c,`${hz(lastNote).toFixed(2)} Hz`,r.x+r.w-pad,r.y+19,'#dce4ff',11,'right');
    c.save();c.shadowBlur=v.traceGlow*12;c.shadowColor=electric;
    const bezel=c.createLinearGradient(cx-rad,cy-rad,cx+rad,cy+rad);bezel.addColorStop(0,'#b6d2ff');bezel.addColorStop(.25,electric);bezel.addColorStop(.55,'#182965');bezel.addColorStop(.8,'#6589e0');bezel.addColorStop(1,'#c4d4fb');
    c.strokeStyle=bezel;c.lineWidth=Math.max(5,rad*.035);c.beginPath();c.ellipse(cx,cy,rad,rad*.88,-.15,0,TAU);c.stroke();
    c.lineWidth=.8;c.strokeStyle=rgba('#bfd6ff',.65);for(const f of [.965,1.035]){c.beginPath();c.ellipse(cx,cy,rad*f,rad*.88*f,-.15,0,TAU);c.stroke();}
    c.lineWidth=.65;c.strokeStyle=rgba(electric,.48);for(const f of [.88,1.09]){c.beginPath();c.ellipse(cx,cy,rad*f,rad*.88*f,-.15,0,TAU);c.stroke();}
    c.restore();
    for(let i=0;i<40;i++){const a=i/40*TAU,rr=i%5===0?1.11:1.075;line(c,[[cx+Math.cos(a)*rad*1.02,cy+Math.sin(a)*rad*.9],[cx+Math.cos(a)*rad*rr,cy+Math.sin(a)*rad*.88*rr]],rgba(electric,i%5===0?.65:.25),.7);}
    const waves=traceHistory.slice(-Math.max(1,Math.floor(1+v.tracePersistence*8)));
    waves.forEach((wave,j)=>{
      const pts=[],fade=(j+1)/waves.length;
      for(let i=0;i<220;i++){const a=i/219*TAU*2,amp=wave.length?clamp(wave[Math.floor(i/220*wave.length)]*v.signalScale,-1,1):0;const radius=rad*(.31+amp*.34);pts.push([cx+Math.cos(a)*radius+Math.sin(a*3+t*.15)*rad*.11,cy+Math.sin(a*1.5)*radius*.88]);}
      line(c,pts,rgba(j===waves.length-1?'#e8f1dc':electric,.025+fade*.16),j===waves.length-1?.6:.4);
    });
    if(!waves.length){const pts=[];for(let i=0;i<180;i++){const a=i/179*TAU;pts.push([cx+Math.cos(a*2)*rad*.27,cy+Math.sin(a*3)*rad*.22]);}line(c,pts,rgba(electric,.3),.7);}
    const measured=snap.waveform||[];
    for(let bucket=0;bucket<cloudBuckets.length;bucket++){
      c.fillStyle=rgba(bucket>3?'#e3f7d9':'#bed3c7',.4+bucket*.065+energy*.16);c.beginPath();
      for(const p of cloudBuckets[bucket]){
        const a=p.a+t*.055,amp=measured.length?clamp(measured[(p.index*13)%measured.length]*v.signalScale,-1,1):0,fold=1+.23*Math.sin(a*3+p.z*4)+amp*.16;
        const rr=rad*.31*fold,xx=p.x*rr,yy=(p.y*.7-p.z*.45)*rr,twist=Math.sin(p.z*3+api.state.sound.index*.2)*rad*.07,size=.8+energy*.35;
        c.rect(cx+xx+twist,cy+yy,size,size);
      }c.fill();
    }
    for(const contact of contacts.values()){if(contact.role!=='shape')continue;const a=(contact.x-.5)*TAU;const px=cx+Math.cos(a)*rad*.6,py=cy+Math.sin(a)*rad*.45;c.strokeStyle='#c3f5a4';c.lineWidth=1.3;c.beginPath();c.arc(px,py,5,0,TAU);c.stroke();line(c,[[cx,cy],[px,py]],rgba('#c3f5a4',.6),.7);}
    const bx=r.x+r.w*.78,by=r.y+r.h*.105,bw=r.w*.037,bh=r.h*.29;
    const params=[['A',Math.log1p(api.state.sound.attack*80)/Math.log1p(160)],['D',Math.log1p(api.state.sound.decay*80)/Math.log1p(160)],['S',api.state.sound.sustain],['R',Math.log1p(api.state.sound.release*80)/Math.log1p(400)]];
    params.forEach(([name,val],i)=>{const xx=bx+i*bw*1.23;c.strokeStyle=rgba(electric,.4);c.lineWidth=v.gridWeight;c.strokeRect(xx,by,bw,bh);const filled=clamp(val,.035,1)*bh;c.fillStyle=rgba('#b9e68a',.45+energy*.45);c.fillRect(xx+2,by+bh-filled,bw-4,filled);for(let yy=by+3;yy<by+bh;yy+=4)line(c,[[xx,yy],[xx+bw,yy]],rgba('#070b18',.55),.6);label(c,name,xx+bw/2,by+bh+12,'#c9d4ed',8,'center');});
    const ly=r.y+r.h*.505,lh=r.h*.073;
    c.strokeStyle=rgba(electric,.32);c.lineWidth=v.gridWeight;c.strokeRect(r.x+pad,ly,r.w-pad*2,lh);
    const time=snap.time||0, recent=events.filter(e=>e.when<=time).slice(0,3);
    for(let i=0;i<3;i++){const e=recent[i],text=e?`${i===0?'NOW ':'PAST'} ${api.noteName(e.midi).padEnd(3)} ${e.when.toFixed(3).padStart(7)}s`:'—';label(c,text,r.x+pad+6,ly+11+i*10,rgba('#d4dcf7',.8-i*.18),7.5);}
    const wave=snap.waveform||[],pts=[];for(let i=0;i<100;i++){const value=wave.length?clamp(wave[Math.floor(i/100*wave.length)]*v.signalScale,-1,1):0;pts.push([r.x+r.w*.48+i/99*r.w*.45,ly+lh/2+value*lh*.38]);}line(c,pts,rgba('#b8e8d2',.8),.8);
    const ky=r.y+r.h*.704,kw=r.w*.91/8,kx=r.x+pad;
    for(let i=0;i<8;i++){
      const hh=(.06+levels[i]*.78)*r.h*.13*v.blockDepth,xx=kx+i*kw+kw*.18,ww=kw*.48,depth=Math.min(10,ww*.27)*v.blockDepth,yy=ky-hh;
      const face=c.createLinearGradient(xx,yy,xx+ww,yy);face.addColorStop(0,'#e3c9ff');face.addColorStop(.35,v.blocks);face.addColorStop(1,'#b18cd8');c.fillStyle=face;c.fillRect(xx,yy,ww,hh);c.fillStyle='#eddbff';c.beginPath();c.moveTo(xx,yy);c.lineTo(xx+depth,yy-depth);c.lineTo(xx+ww+depth,yy-depth);c.lineTo(xx+ww,yy);c.closePath();c.fill();c.fillStyle=rgba(v.blocks,.72);c.beginPath();c.moveTo(xx+ww,yy);c.lineTo(xx+ww+depth,yy-depth);c.lineTo(xx+ww+depth,ky-depth);c.lineTo(xx+ww,ky);c.closePath();c.fill();
      for(let sy=yy+2;sy<ky;sy+=2.5)line(c,[[xx,sy],[xx+ww,sy]],rgba('#f4e7ff',.45),.5);line(c,[[xx,yy],[xx,ky]],rgba('#fff0ff',.8),.8);
      line(c,[[xx,ky+3],[xx+ww+depth,ky+3]],rgba(electric,.3),.6);
    }
    drawKeyboard(r,true,v,t);c.restore();
  }
  function cancel(){for(const p of contacts.values())if(p.role!=='knob')api.noteOff(p.id);for(const id of keyIds)api.noteOff(id);contacts.clear();keyIds.clear();}
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
    destroy(){cancel();off();reliefCanvas.width=0;reliefCanvas.height=0;surface.destroy();}
  };
}
