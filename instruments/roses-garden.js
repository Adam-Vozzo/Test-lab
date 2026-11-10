import {splitLayout} from '../instrument-layout.js';
import {clamp,seeded,rgba} from './kit.js';

export function createRoseGarden(host,api,play){
 const root=document.createElement('div');root.className='rose-garden';
 root.innerHTML=`<style>
 .rose-garden{position:absolute;inset:0;color:#b9c8b5;font:11px "SFMono-Regular",Consolas,monospace;isolation:isolate}
 .rose-garden .rg-growth{position:absolute;inset:0;pointer-events:none;z-index:3}
 .rose-garden .rg-flower,.rose-garden .rg-console{position:absolute;min-width:0;min-height:0;overflow:hidden}
 .rose-garden .rg-flower{border:1px solid #3e51504a;background:radial-gradient(ellipse at 45% 35%,#22122755,transparent 65%)}
 .rose-garden .rg-flower:before{content:'ROSA / PETAL ARRAY';position:absolute;top:15px;left:16px;letter-spacing:2px;font-size:9px;color:#8eaaa1;z-index:2;pointer-events:none}
 .rose-garden .rg-console{padding:16px 18px;display:flex;flex-direction:column;gap:14px;border:1px solid #3e51504a;background:linear-gradient(150deg,#0c1515aa,#100b18aa)}
 .rose-garden .rg-header{display:flex;align-items:center;justify-content:space-between;font-size:10px;letter-spacing:2px;min-height:20px}
 .rose-garden .rg-header output{letter-spacing:0;color:#e9a1bf}
 .rose-garden .rg-caption{font-size:9px;letter-spacing:1.3px;color:#91a396;display:flex;justify-content:space-between;gap:8px;margin-bottom:9px}
 .rose-garden button{font:inherit;touch-action:none;border-radius:0;color:inherit;cursor:pointer}
 .rose-garden .rg-flowers{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}
 .rose-garden .rg-flowers button{height:45px;border:1px solid #62756b65;background:transparent;position:relative;color:#b9c8b5}
 .rose-garden button{transition:background .13s,border-color .13s}.rose-garden input::-webkit-slider-thumb{border-radius:0!important;width:8px!important;height:13px!important}.rose-garden input::-moz-range-thumb{border-radius:0!important}
 .rose-garden .rg-flowers button:before{content:'✣';margin-right:8px;color:#d84a83;font-size:17px}
 .rose-garden button:active,.rose-garden .rg-flowers button[data-active=true]{background:#69475d55;border-color:#e6a0ba}
 .rose-garden .rg-pad{position:relative;flex:1;min-height:70px;border:1px solid #617a6b70;touch-action:none;overflow:hidden;background:linear-gradient(90deg,#33473912 1px,transparent 1px),linear-gradient(#33473918 1px,transparent 1px);background-size:24px 24px}
 .rose-garden .rg-pad .rg-axis{position:absolute;bottom:10px;left:12px;color:#90a899;font-size:9px;letter-spacing:1px}
 .rose-garden .rg-pad .rg-pad-values{position:absolute;top:10px;left:12px;color:#e6a0ba;font-size:10px}
 .rose-garden .rg-cursor{position:absolute;width:26px;height:26px;transform:translate(-50%,-50%);border:1px solid #c9d6af;pointer-events:none;box-shadow:0 0 18px #bd72942a}
 .rose-garden .rg-cursor:before{content:'';position:absolute;inset:8px;background:#f099bb;box-shadow:-7px 0 #9cbda680,7px 0 #9cbda680,0 -7px #9cbda680,0 7px #9cbda680}
 .rose-garden .rg-cursor:after{content:'';position:absolute;left:-100vw;right:-100vw;top:12px;border-top:1px dashed #8ba78b38}
 .rose-garden .rg-seq{display:grid;grid-template-columns:repeat(8,1fr);gap:5px}
 .rose-garden .rg-seq button{min-height:39px;border:1px solid #586a5f70;background:transparent;font-size:9px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
 .rose-garden .rg-seq button span{color:#688076;font-size:8px}
 .rose-garden .rg-seq button[data-current=true]{border-color:#d4e4b7;background:#40564244;box-shadow:inset 0 -3px #cee2ae}
 .rose-garden .rg-seq button[data-rest=true]{opacity:.45}
 .rose-garden .rg-sliders{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px}
 .rose-garden .rg-sliders label{display:grid;grid-template-columns:1fr auto;align-items:center;gap:4px;font-size:9px;letter-spacing:.5px;min-width:0}
 .rose-garden .rg-sliders output{font-variant-numeric:tabular-nums;color:#c4d6b9}
 .rose-garden .rg-sliders input{grid-column:1/-1;width:100%;min-width:0;height:24px;accent-color:#c99eb3;touch-action:none}
 .rose-garden .rg-foot{border-top:1px solid #48584c70;padding-top:10px;display:flex;justify-content:space-between;font-size:9px;color:#80998c;letter-spacing:1px}
 @media(max-height:500px){.rose-garden .rg-console{padding:8px 12px;gap:7px}.rose-garden .rg-flowers button{height:30px}.rose-garden .rg-header{min-height:14px}.rose-garden .rg-caption{margin-bottom:4px;font-size:8px}.rose-garden .rg-seq button{min-height:25px;gap:1px}.rose-garden .rg-sliders{gap:3px 14px}.rose-garden .rg-sliders input{height:18px}.rose-garden .rg-foot{display:none}.rose-garden .rg-pad{min-height:48px}}
 @media(max-width:600px){.rose-garden .rg-console{padding:10px 12px;gap:6px}.rose-garden .rg-header{min-height:14px}.rose-garden .rg-sliders input{height:18px}.rose-garden .rg-flowers button{height:30px}.rose-garden .rg-seq button{min-height:28px}.rose-garden .rg-foot{display:none}.rose-garden .rg-pad{min-height:52px}.rose-garden .rg-caption{margin-bottom:5px}}
 </style><div class="rg-flower"></div><section class="rg-console" aria-label="Rose sequence and timbre">
 <div class="rg-header"><span>CHIME / 05</span><output class="rg-voice">00 VOICES</output></div>
 <div class="rg-flowers" role="group" aria-label="Play flower"></div>
 <div class="rg-pad" role="slider" tabindex="0" aria-label="Chime mix. Left and right change glass; up and down change body."><span class="rg-pad-values"></span><span class="rg-axis">X GLASS · Y BODY</span><i class="rg-cursor"></i></div>
 <div><div class="rg-caption"><span>PETAL MEMORY / 16</span><span>TAP → FLOWER / REST</span></div><div class="rg-seq"></div></div>
 <div class="rg-sliders"></div><div class="rg-foot"><span class="rg-clock">STEP 01 / 16</span><span>ROSA · GLASS / BODY</span></div>
 </section><canvas class="rg-growth" aria-hidden="true"></canvas>`;
 host.append(root);const flower=root.querySelector('.rg-flower'),panel=root.querySelector('.rg-console'),growth=root.querySelector('canvas'),c=growth.getContext('2d'),abort=new AbortController(),options={signal:abort.signal},timers=new Set(),events=[];
 const ground=document.createElement('canvas'),gc=ground.getContext('2d');
 let pattern=[0,2,1,4,3,1,0,2,4,3,1,0,2,1,3,4],current=-1,selected=0,layout=null,size='',branches=[],inputs=[],padSources=new Set();
 const pads=root.querySelector('.rg-flowers'),seq=root.querySelector('.rg-seq'),pad=root.querySelector('.rg-pad'),cursor=pad.querySelector('i');
 function audition(index){const id='roses-console-'+performance.now();play(index,id,true);const timer=setTimeout(()=>{play(index,id,false);timers.delete(timer);},170);timers.add(timer);}
 for(let i=0;i<5;i++){const b=document.createElement('button');b.type='button';b.textContent=String(i+1).padStart(2,'0');b.setAttribute('aria-label','Play flower '+(i+1));b.addEventListener('click',()=>{selected=i;audition(i);},options);pads.append(b);}
 function refresh(){[...seq.children].forEach((b,i)=>{b.innerHTML='<span>'+String(i+1).padStart(2,'0')+'</span>'+(pattern[i]<0?'—':String(pattern[i]+1).padStart(2,'0'));b.dataset.rest=pattern[i]<0;b.setAttribute('aria-label','Step '+(i+1)+': '+(pattern[i]<0?'rest':'flower '+(pattern[i]+1))+'. Tap to change.');});}
 for(let i=0;i<16;i++){const b=document.createElement('button');b.type='button';b.addEventListener('click',()=>{pattern[i]=pattern[i]>=4?-1:pattern[i]+1;if(pattern[i]>=0)audition(pattern[i]);refresh();api.save();},options);seq.append(b);}refresh();
 for(const [key,name,min,max,step,unit]of [['roseDecay','GLASS DECAY',0,1,.01,''],['release','RELEASE',.1,5,.05,'s'],['echo','DELAY',0,.45,.01,''],['cutoff','LOW-PASS',800,18000,50,'Hz']]){
  const l=document.createElement('label');l.innerHTML=`<span>${name}</span><output></output><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${name}">`;const input=l.querySelector('input'),out=l.querySelector('output');input.addEventListener('input',()=>api.setSound({[key]:Number(input.value)}),options);root.querySelector('.rg-sliders').append(l);inputs.push({input,out,key,unit});
 }
 function mix(e){const r=pad.getBoundingClientRect();api.setSound({roseGlass:clamp((e.clientX-r.left)/r.width),roseBody:clamp(1-(e.clientY-r.top)/r.height)});}
 pad.addEventListener('pointerdown',e=>{e.preventDefault();pad.setPointerCapture(e.pointerId);mix(e);const id='roses-pad-'+e.pointerId;padSources.add(id);play(selected,id,true);},options);
 pad.addEventListener('pointermove',e=>{if(pad.hasPointerCapture(e.pointerId))mix(e);},options);
 const end=e=>{const id='roses-pad-'+e.pointerId;if(padSources.delete(id))play(selected,id,false,e.type==='pointercancel');};for(const type of ['pointerup','pointercancel','lostpointercapture'])pad.addEventListener(type,end,options);
 pad.addEventListener('keydown',e=>{const d={ArrowLeft:['roseGlass',-.03],ArrowRight:['roseGlass',.03],ArrowUp:['roseBody',.03],ArrowDown:['roseBody',-.03]}[e.key];if(d){e.preventDefault();api.setSound({[d[0]]:clamp(api.state.sound[d[0]]+d[1])});}},options);
 function resize(v){const r=root.getBoundingClientRect();layout=splitLayout(r.width,r.height,v,{pad:5,gap:18});for(const [el,box]of[[flower,layout.left],[panel,layout.right]])Object.assign(el.style,{left:box.x+'px',top:box.y+'px',width:box.w+'px',height:box.h+'px'});
  const key=[r.width,r.height,v.growthDensity,v.pixelScale,v.mossColour,v.petalColour].join('|');if(key!==size){size=key;growth.width=Math.ceil(r.width);growth.height=Math.ceil(r.height);growth.style.width=r.width+'px';growth.style.height=r.height+'px';ground.width=growth.width;ground.height=growth.height;const randomGround=seeded(991),unit=Math.max(2,Math.round(v.pixelScale??2));
   for(const box of[layout.left,layout.right])for(const side of[-1,1])for(let j=0;j<240*(v.growthDensity??.9);j++){
    const y=box.y+randomGround()*box.h,depth=Math.pow(randomGround(),2)*Math.min(45,box.w*.12),x=side<0?box.x+depth:box.x+box.w-depth;
    gc.fillStyle=rgba([v.mossColour||'#548b86','#32444f','#51334f','#244540'][j%4],.10+randomGround()*.18);gc.fillRect(Math.round(x/unit)*unit,Math.round(y/unit)*unit,unit*(1+Math.floor(randomGround()*4)),unit*(1+Math.floor(randomGround()*3)));
   }
   branches=[];const random=seeded(731),count=Math.round(32*(v.growthDensity??.65));for(let i=0;i<count;i++){const edge=i%4;branches.push({edge,start:(i%3===0?.27:.76)+(random()-.5)*.14,length:45+random()*110,phase:random()*6.28,seed:random(),leaves:Array.from({length:14},()=>random())});}}
 }
 return{flower,root,get pattern(){return pattern;},setPattern(p){if(Array.isArray(p)&&p.length===16)pattern=p.map(n=>Math.round(clamp(n,-1,4)));refresh();},scheduleStep(index,when){events.push({index,when});},
 frame(v,t,snap){resize(v);while(events.length&&events[0].when<=snap.time)current=events.shift().index;[...seq.children].forEach((b,i)=>b.dataset.current=api.state.playing&&i===current);[...pads.children].forEach((b,i)=>b.dataset.active=i===selected);
  for(const {input,out,key,unit}of inputs){if(document.activeElement!==input)input.value=api.state.sound[key];const val=api.state.sound[key];out.textContent=key==='cutoff'?(val/1000).toFixed(1)+'k':val.toFixed(2)+unit;}
  cursor.style.left=(api.state.sound.roseGlass*100)+'%';cursor.style.top=((1-api.state.sound.roseBody)*100)+'%';pad.querySelector('.rg-pad-values').textContent=api.state.sound.roseGlass.toFixed(2)+' / '+api.state.sound.roseBody.toFixed(2);pad.setAttribute('aria-valuetext','Glass '+api.state.sound.roseGlass.toFixed(2)+', body '+api.state.sound.roseBody.toFixed(2));root.querySelector('.rg-voice').textContent=String(snap.voices.filter(q=>q.gate).length).padStart(2,'0')+' VOICES';root.querySelector('.rg-clock').textContent='STEP '+String(Math.max(0,current)+1).padStart(2,'0')+' / 16';
  c.clearRect(0,0,growth.width,growth.height);
  const pr=pad.getBoundingClientRect(),rr=root.getBoundingClientRect(),ox=pr.x-rr.x,oy=pr.y-rr.y,pw=pr.width,ph=pr.height,glass=api.state.sound.roseGlass,body=api.state.sound.roseBody,light=clamp(snap.rms*8),pt=api.reducedMotion?0:t*.3;
  c.save();c.beginPath();c.rect(ox+3,oy+30,pw-6,ph-49);c.clip();c.drawImage(ground,0,0);
  // Parameter-shaped contour beds make the pad a readable transfer surface.
  for(let band=0;band<15;band++){
   c.beginPath();for(let k=0;k<=70;k++){const f=k/70,x=ox+f*pw,y=oy+ph*(.2+band*.043)+Math.sin(f*5+band*.2+pt*.3)*(12+body*30)+Math.sin(f*12+glass*4)*glass*8;
    if(k)c.lineTo(Math.round(x/2)*2,Math.round(y/2)*2);else c.moveTo(x,y);
   }c.strokeStyle=rgba(band%4?v.mossColour:v.petalColour,.14+body*.1+light*.3);c.lineWidth=1;c.setLineDash(band%3?[2,5]:[9,4]);c.stroke();c.setLineDash([]);
  }
  // A pixel-root transfer field is controlled by the same glass/body coordinates.
  const tx=ox+glass*pw,ty=oy+(1-body)*ph;
  for(let strand=0;strand<9;strand++){
   let prev=null;for(let k=0;k<38;k++){
    const f=k/37,bx=ox+pw*(.08+strand*.105),xx=bx+(tx-bx)*f+Math.sin(f*6+strand+pt)*Math.sin(f*Math.PI)*(8+glass*18),yy=oy+ph-4+(ty-oy-ph+4)*f;
    const x=Math.round(xx/2)*2,y=Math.round(yy/2)*2;c.fillStyle=rgba(strand%3?v.mossColour:v.petalColour,.25+light*.4+f*.3);c.fillRect(x,y,2,f>.8?2:1);
    if(k%4===0){c.fillStyle=rgba(v.mossColour,.12+body*.18);c.fillRect(x+3,y-3,4+body*6,2);c.fillRect(x-5,y+2,3,2);}
    prev={x,y};
   }
  }
  c.restore();const px=Math.max(1,Math.round(v.pixelScale??2)),motion=api.reducedMotion?0:t*(v.growthMotion??.5),cols=[v.mossColour||'#568377','#263b48','#693858',v.petalColour];
  // Pixel ferns inhabit the perimeter, leaving controls and sculpture readable.
  for(const b of branches){
   const box=b.edge<2?{...layout.left,y:layout.left.y+42,h:layout.left.h-90}:{x:ox+3,y:oy+32,w:pw-6,h:ph-54},side=b.edge%2?-1:1,x=side===1?box.x+4:box.x+box.w-4,y=box.y+box.h*b.start,len=Math.min(b.length,box.w*.20);
   c.save();c.beginPath();c.rect(box.x,box.y,box.w,box.h);c.clip();c.fillStyle='#263f3a';c.fillRect(x-3,y-3,7,7);let previous={x,y};
   for(let k=0;k<14;k++){
    const f=k/13,sway=Math.sin(motion+b.phase+f*2)*f*3,xx=Math.round((x+side*f*len)/px)*px,yy=Math.round((y-Math.sin(f*1.6)*len*.45+sway)/px)*px;
    c.beginPath();c.moveTo(previous.x,previous.y);c.lineTo(xx,previous.y);c.lineTo(xx,yy);c.strokeStyle=rgba(v.mossColour,.72);c.lineWidth=px*1.4;c.stroke();previous={x:xx,y:yy};
    const leaf=Math.max(2,(1-f)*20*(.5+b.leaves[k]));
    for(const sign of[-1,1])for(let n=0;n<leaf;n+=px){
     const lx=Math.round((xx+side*n*.55)/px)*px,ly=Math.round((yy+sign*n)/px)*px,width=px*Math.max(1,Math.round(Math.sin(n/leaf*Math.PI)*2.5));
     c.fillStyle=rgba('#263f3a',.92);c.fillRect(lx-width*.5,ly,width+px,px);
     c.fillStyle=rgba(v.mossColour,.72);c.fillRect(lx,ly,width,px);
     if((k+Math.floor(n/px))%3===0){c.fillStyle=rgba('#aac0a2',.42);c.fillRect(lx+width-px,ly,px,px);}
    }
    if(k===12&&b.seed>.45){c.fillStyle=rgba(v.petalColour,.85);c.fillRect(xx-px,yy-px,px*3,px*2);c.fillStyle='#cba3b8';c.fillRect(xx,yy-px,px,px);}
   }c.restore();
  }
 },cancel(){for(const id of padSources)api.noteCancel(id);padSources.clear();events.length=0;},destroy(){this.cancel();for(const timer of timers)clearTimeout(timer);timers.clear();abort.abort();root.remove();}};
}
