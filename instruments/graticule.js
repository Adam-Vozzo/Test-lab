import * as THREE from '../vendor/three.module.min.js';
import {TAU,clamp,lerp,rgba,createSurface,bindPointers,label,line} from './kit.js';

export const definition={
  id:'graticule',name:'Graticule / Lissajous',batch:2,
  theme:{bg:'#05070a',fg:'#f2f4ee',accent:'#ffb14b',muted:'#8c949c'},
  defaultSound:{waveform:'sawtooth',attack:.012,decay:.3,sustain:.6,release:1.3,cutoff:10000,resonance:1,gain:.3,ratio:1.5,index:.75,glide:.035,echo:.15},
  defaultAppearance:{guideOpacity:.7,radialDivisions:28,traceWeight:1.4,phosphor:.85,persistence:.7,phaseSamples:1050,phaseDotSize:2.6,phasePitch:4,phaseDepth:.85,phaseAngle:-.48,phaseTilt:.55,phaseSlices:12,phaseDelay:.025,radialMotion:.5,polarColour:'#ffb14b',phaseColour:'#a8dfff',background:'#05070a'},
  soundControls:[
    {key:'ratio',label:'Frequency ratio',min:.25,max:8,step:.25,unit:'×',section:'Oscillator relationship',description:'Modulator/carrier ratio; also the horizontal axis of the right playing surface.'},
    {key:'index',label:'Modulation index',min:0,max:10,step:.05,section:'Oscillator relationship',description:'FM depth, shown by deformation of the phase-space trace.'},
    {key:'glide',label:'Pitch glide',min:.003,max:.3,step:.005,unit:'s',section:'Polar pitch',description:'Pitch transition time as the contact crosses degree sectors.'}
  ],
  appearanceControls:[
    {key:'guideOpacity',label:'Polar guide opacity',min:.05,max:.8,step:.01,section:'Graticule',description:'Visibility of radial divisions and octave rings.'},
    {key:'radialDivisions',label:'Radial divisions',min:7,max:56,step:1,section:'Graticule',description:'Number of angular guide divisions, independent of musical quantization.'},
    {key:'traceWeight',label:'Orbit stroke',min:.5,max:3,step:.1,unit:'px',section:'Graticule',description:'Stroke width of the sounding orbit traces.'},
    {key:'radialMotion',label:'Orbit phase motion',min:0,max:1.5,step:.05,section:'Graticule',description:'Slow phase advance of each sounding note’s orbit.'},
    {key:'phosphor',label:'Phosphor glow',min:0,max:1.5,step:.05,section:'Phosphor',description:'Local glow of the orange traces and phase dots.'},
    {key:'persistence',label:'Trace persistence',min:0,max:1,step:.05,section:'Phosphor',description:'Visibility of delayed signal slices behind the current carrier/modulator curve.'},
    {key:'phaseSamples',label:'Phase samples',min:200,max:1400,step:50,section:'Phase plot',description:'Number of points used to plot the carrier/modulator relationship.'},
    {key:'phaseDotSize',label:'Phase dot size',min:.6,max:3.5,step:.1,unit:'px',section:'Phase plot',description:'Size of individual points in the blue phase plot.'},
    {key:'phasePitch',label:'Phase grid pitch',min:2,max:10,step:.5,unit:'px',section:'Phase plot',description:'Spacing of the fixed dot grid used to sample the phase-space figure.'},
    {key:'phaseDepth',label:'Phase depth',min:0,max:1,step:.05,section:'Phase plot',description:'Separation of time-delay slices and quarter-cycle carrier depth.'},
    {key:'phaseSlices',label:'Depth slices',min:2,max:16,step:1,section:'Phase plot',description:'Number of delayed carrier/modulator sample planes in the volume.'},
    {key:'phaseDelay',label:'Slice delay',min:0,max:.08,step:.005,unit:'cyc',section:'Phase plot',description:'Time lag between carrier and modulator samples in successive depth slices, measured in carrier cycles.'},
    {key:'phaseTilt',label:'Plot tilt',min:-1.2,max:1.2,step:.05,unit:'rad',section:'Phase plot',description:'Vertical viewing angle that reveals separation between delayed sample planes.'},
    {key:'phaseAngle',label:'Plot rotation',min:-1.5,max:1.5,step:.05,unit:'rad',section:'Phase plot',description:'Viewing angle of the phase-space figure; does not change pitch.'},
    {key:'polarColour',label:'Polar colour',kind:'color',section:'Palette',description:'Colour of radial guides and sounding orbital traces.'},
    {key:'phaseColour',label:'Phase colour',kind:'color',section:'Palette',description:'Colour of the dotted carrier/modulator plot.'},
    {key:'background',label:'Plot background',kind:'color',section:'Palette',description:'Background colour of the two plotting surfaces.'}
  ]
};

export function polarGeometry(width,height){const top=64,bottom=Math.max(top+55,height-88),x=width*.255,y=(top+bottom)*.5,r=Math.max(20,Math.min(width*.215,(bottom-top)*.48));return{x,y,r,top,bottom};}
export function polarMapping(nx,ny,aspect=1.5,height=720){const width=aspect*height,g=polarGeometry(width,height),x=(nx*width-g.x)/g.r,y=(ny*height-g.y)/g.r,r=clamp(Math.hypot(x,y),0,1),angle=((Math.atan2(y,x)+Math.PI*.5)%TAU+TAU)%TAU;return{degree:Math.min(6,Math.floor(angle/TAU*7)),octave:Math.min(2,Math.floor(r*3))-1,r,angle};}
const waveformTables=new Map();
function oscillatorPoint(theta,waveform){
  if(waveform==='sine')return{value:Math.sin(theta),slope:Math.cos(theta),maxSlope:1};
  if(!waveformTables.has(waveform)){
    const size=2048,values=new Float32Array(size+1),slopes=new Float32Array(size+1);let maxSlope=0;
    const harmonics=[];for(let n=1;n<=16;n++){
      let amplitude=waveform==='sawtooth'?2/Math.PI*(n%2?1:-1)/n:waveform==='square'?(n%2?4/Math.PI/n:0):(n%2?8/Math.PI**2*(n%4===1?1:-1)/(n*n):0);
      // A cosine taper models the finite bandwidth of the oscillator and
      // keeps discontinuities finite rather than inventing vertical spikes.
      amplitude*=.5+.5*Math.cos(n/17*Math.PI);harmonics.push([n,amplitude]);maxSlope+=Math.abs(n*amplitude);
    }
    for(let i=0;i<=size;i++){const a=i/size*TAU;for(const[n,amp]of harmonics){values[i]+=amp*Math.sin(n*a);slopes[i]+=n*amp*Math.cos(n*a);}}
    const peak=Math.max(1,...values.map(Math.abs));for(let i=0;i<=size;i++){values[i]/=peak;slopes[i]/=peak;}maxSlope/=peak;waveformTables.set(waveform,{values,slopes,maxSlope,size});
  }
  const table=waveformTables.get(waveform),f=((theta/TAU%1)+1)%1*table.size,i=Math.floor(f),q=f-i;return{value:lerp(table.values[i],table.values[i+1],q),slope:lerp(table.slopes[i],table.slopes[i+1],q),maxSlope:table.maxSlope};
}
export function phasePoint(theta,ratio,index,waveform='sine'){
  // The audio engine adds fc*index*sin(fm*t) to carrier frequency. Integrating
  // it gives this phase, with both oscillators beginning at phase zero.
  const mod=Math.sin(theta*ratio),phase=theta+index/ratio*(1-Math.cos(theta*ratio)),osc=oscillatorPoint(phase,waveform);
  return{carrier:osc.value,mod,derivative:osc.slope*(1+index*mod)/(osc.maxSlope*(1+index)),quadrature:oscillatorPoint(phase+Math.PI*.5,waveform).value};
}

export function mount(host,api){
  const wrapper=document.createElement('div');wrapper.style.cssText='position:absolute;inset:0;overflow:hidden;';host.append(wrapper);
  const baseCanvas=document.createElement('canvas');baseCanvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';wrapper.append(baseCanvas);const bg=baseCanvas.getContext('2d');
  const surface=createSurface(wrapper,{label:'Polar pitch and phase-space instrument. Left: angle selects pitch, radius selects octave. Right: horizontal motion changes ratio, vertical motion changes FM index.'});surface.canvas.style.cssText+='position:relative;z-index:2;';const c=surface.ctx,contacts=new Map();
  let renderer=null,scene,camera,points,geometry,material,positions,alpha,shade,pointColor,lastW=0,lastH=0,selected=api.quantize(0),degree=0,octave=0,selectedPos={nx:.255,ny:.3},step=-1,lastPlotKey='';
  const maxSamples=1400,maxPoints=maxSamples*16;
  try{
    renderer=new THREE.WebGLRenderer({alpha:true,premultipliedAlpha:true,antialias:false,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';wrapper.insertBefore(renderer.domElement,surface.canvas);
    scene=new THREE.Scene();camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,2000);camera.position.z=700;
    geometry=new THREE.BufferGeometry();positions=new Float32Array(maxPoints*3);alpha=new Float32Array(maxPoints);shade=new Float32Array(maxPoints);geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('alpha',new THREE.BufferAttribute(alpha,1).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('shade',new THREE.BufferAttribute(shade,1).setUsage(THREE.DynamicDrawUsage));
    material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{colour:{value:new THREE.Color('#a8dfff')},size:{value:2},glow:{value:.5}},vertexShader:'attribute float alpha;attribute float shade;uniform float size;varying float a;varying float vShade;void main(){a=alpha;vShade=shade;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size;}',fragmentShader:'uniform vec3 colour;uniform float glow;varying float a;varying float vShade;void main(){vec2 q=abs(gl_PointCoord-.5)*2.;float r=length(q),core=1.-smoothstep(.42,.55,max(q.x,q.y)),halo=exp(-r*r*4.)*glow*.17;gl_FragColor=vec4(mix(colour*vec3(.32,.5,.92),mix(colour,vec3(1.),core*.4),vShade),min(.98,a*(core+halo)));\n#include <colorspace_fragment>\n}' });points=new THREE.Points(geometry,material);points.frustumCulled=false;scene.add(points);
  }catch{renderer?.dispose();renderer=null;}
  function modulate(p){const ratio=Math.round(clamp((p.nx-.535)/.43,0,1)*31+1)/4,index=Math.round(clamp((.86-p.ny)/.72,0,1)*200)/20;api.setSound({ratio,index});}
  const soundOptions=()=>({...api.state.sound});
  const unbind=bindPointers(surface.canvas,{
    down:p=>{const side=p.nx<.5?'polar':'phase',ownsVoice=side==='polar'||(!contacts.size&&!api.audio.snapshot().voices.some(v=>v.level>.001));const q={side,ownsVoice,midi:selected,nx:p.nx,ny:p.ny};contacts.set(p.id,q);
      if(side==='polar'){const hit=polarMapping(p.nx,p.ny,surface.width/surface.height,surface.height);degree=hit.degree;octave=hit.octave;q.midi=selected=api.quantize(degree,octave);selectedPos={nx:p.nx,ny:p.ny};}else modulate(p);
      if(ownsVoice)api.noteOn('polar-'+p.id,q.midi,soundOptions());api.setStatus(`${api.noteName(selected)} · ${api.state.sound.ratio.toFixed(2)}×`);},
    move:p=>{const q=contacts.get(p.id);if(!q)return;q.nx=p.nx;q.ny=p.ny;if(q.side==='polar'){const hit=polarMapping(p.nx,p.ny,surface.width/surface.height,surface.height);degree=hit.degree;octave=hit.octave;q.midi=selected=api.quantize(degree,octave);selectedPos={nx:p.nx,ny:p.ny};api.noteUpdate('polar-'+p.id,q.midi,soundOptions());}else modulate(p);api.setStatus(`${api.noteName(selected)} · ${api.state.sound.ratio.toFixed(2)}×`);},
    up:p=>{if(contacts.get(p.id)?.ownsVoice)api.noteOff('polar-'+p.id);contacts.delete(p.id);api.save();},
    cancel:p=>{if(contacts.get(p.id)?.ownsVoice)api.noteOff('polar-'+p.id);contacts.delete(p.id);}
  });
  function plots(w,h,v){
    const plotKey=JSON.stringify([w,h,surface.dpr,v.background,v.polarColour,v.phaseColour,v.guideOpacity,v.radialDivisions,api.state.root,api.state.scale]);
    if(plotKey===lastPlotKey)return polarGeometry(w,h);lastPlotKey=plotKey;
    if(baseCanvas.width!==Math.round(w*surface.dpr)||baseCanvas.height!==Math.round(h*surface.dpr)){baseCanvas.width=Math.round(w*surface.dpr);baseCanvas.height=Math.round(h*surface.dpr);bg.setTransform(surface.dpr,0,0,surface.dpr,0,0);}
    bg.fillStyle=v.background;bg.fillRect(0,0,w,h);const{x,y,r,top,bottom}=polarGeometry(w,h);
    bg.strokeStyle=rgba(v.polarColour,v.guideOpacity);bg.lineWidth=.6;
    for(let n=1;n<=9;n++){bg.strokeStyle=rgba(v.polarColour,v.guideOpacity*(n%3===0?1:.62));bg.beginPath();bg.arc(x,y,r*n/9,0,TAU);bg.stroke();}
    const box={x:w*.035,y:top,w:w*.44,h:bottom-top};bg.strokeStyle=rgba('#d9e0df',.36);bg.lineWidth=.75;bg.strokeRect(box.x,box.y,box.w,box.h);
    for(let i=0;i<420;i++){const rr=r*Math.sqrt(((i*97)%419)/419),a=i*2.399963,xx=x+Math.cos(a)*rr,yy=y+Math.sin(a)*rr;bg.fillStyle=rgba(i%9===0?'#e6f1ff':v.polarColour,i%11===0?.6:.24);bg.fillRect(xx,yy,i%13===0?1.8:1,i%13===0?1.8:1);}
    for(let i=0;i<84;i++){const a=i/84*TAU,r1=r*(i%7===0?.955:.978);line(bg,[[x+Math.cos(a)*r1,y+Math.sin(a)*r1],[x+Math.cos(a)*r,y+Math.sin(a)*r]],rgba(v.polarColour,.6),.8);}
    const spokeColours=['#ffcc6d','#99ceff','#ed7db7','#b5ed89','#f0dd65','#7cebe4','#ad9bff'];for(let i=0;i<7;i++){const a=i/7*TAU-Math.PI*.5,dx=Math.cos(a),dy=Math.sin(a);line(bg,[[x,y],[x+dx*r,y+dy*r]],rgba(spokeColours[i],.9),1.45);bg.fillStyle=spokeColours[i];bg.beginPath();bg.moveTo(x+dx*r,y+dy*r);bg.lineTo(x+dx*(r-7)-dy*3,y+dy*(r-7)+dx*3);bg.lineTo(x+dx*(r-7)+dy*3,y+dy*(r-7)-dx*3);bg.closePath();bg.fill();}
    for(let n=0;n<v.radialDivisions;n++){const a=n/v.radialDivisions*TAU;line(bg,[[x,y],[x+Math.cos(a)*r,y+Math.sin(a)*r]],rgba(v.polarColour,v.guideOpacity*.6),.6);}
    for(let i=0;i<7;i++){const a=i/7*TAU-Math.PI/2;label(bg,api.noteName(api.quantize(i)).replace(/\d/g,''),x+Math.cos(a)*(r+15),y+Math.sin(a)*(r+15),rgba(v.polarColour,.7),w<650?8:10,'center');}
    for(let i=0;i<3;i++)label(bg,['−1','0','+1'][i],x+8,y-r*(i+1)/3+8,rgba(v.polarColour,.4),8);
    line(bg,[[w*.5,25],[w*.5,h-25]],rgba(v.phaseColour,.14),.6);
    const px=w*.765,py=y,pw=w*.4,ph=(bottom-top)*.86;
    bg.strokeStyle=rgba(v.phaseColour,.3);bg.lineWidth=.7;bg.strokeRect(w*.535,top,w*.43,bottom-top);
    for(let i=0;i<=8;i++){const xx=px-pw*.5+pw*i/8;line(bg,[[xx,py-ph*.5],[xx,py+ph*.5]],rgba(v.phaseColour,.035),.5);}
    for(let i=0;i<=6;i++){const yy=py-ph*.5+ph*i/6;line(bg,[[px-pw*.5,yy],[px+pw*.5,yy]],rgba(v.phaseColour,.035),.5);}
    line(bg,[[px-pw*.5,py],[px+pw*.5,py]],rgba(v.phaseColour,.25),.7);line(bg,[[px,py-ph*.5],[px,py+ph*.5]],rgba(v.phaseColour,.25),.7);
    label(bg,'−1',px-pw*.5,py+13,rgba(v.phaseColour,.3),8);label(bg,'+1',px+pw*.5,py+13,rgba(v.phaseColour,.3),8,'right');label(bg,'M',px+7,py-ph*.5,rgba(v.phaseColour,.5),8);label(bg,'C',px+pw*.5,py-9,rgba(v.phaseColour,.5),8,'right');
    return{x,y,r,top,bottom};
  }
  function radialTrace(w,h,v,snap,t,plot){
    const{x,y,r}=plot,all=snap.voices.filter(q=>q.level>.005).sort((a,b)=>b.level-a.level),voices=[];
    for(const q of all)if(!voices.some(n=>n.midi===q.midi))voices.push(q);
    const notes=voices.length?voices.slice(0,6):[{midi:selected,level:0,id:'idle'}];
    c.save();c.beginPath();c.rect(w*.035,plot.top,w*.44,plot.bottom-plot.top);c.clip();
    for(let k=0;k<notes.length;k++){
      const n=notes[k],degreeIndex=Array.from({length:7},(_,i)=>i).find(i=>((api.quantize(i)-n.midi)%12+12)%12===0)??0,a=degreeIndex/7*TAU-Math.PI*.5,rr=r*(.48+clamp((n.midi-api.state.root+12)/36,0,1)*.43),level=n.id==='idle'?.04:clamp(Math.sqrt(n.level)*1.9,0,1),phase=(api.reducedMotion?0:t)*.32*v.radialMotion;
      const ox=x+Math.cos(a)*r*.12,oy=y+Math.sin(a)*r*.08,flatten=.9+.06*Math.sin(a),head=a+phase*.24;
      c.strokeStyle=rgba(v.polarColour,.28+level*.62);c.lineWidth=v.traceWeight;c.shadowColor=v.polarColour;c.shadowBlur=v.phosphor*(7+level*10);c.beginPath();c.ellipse(ox,oy,rr,rr*flatten,0,0,TAU);c.stroke();
      const hx=ox+Math.cos(head)*rr,hy=oy+Math.sin(head)*rr*flatten;
      line(c,[[x,y],[hx,hy]],rgba(v.polarColour,.35+level*.45),v.traceWeight*.8);
      if(k<4&&level>.07){
        for(let j=27;j>=0;j--){const q=j/27,aa=head-q*.82,xx=ox+Math.cos(aa)*rr,yy=oy+Math.sin(aa)*rr*flatten;c.fillStyle=rgba(v.polarColour,(1-q)*level*.12);c.beginPath();c.ellipse(xx,yy,r*(.06+level*.08)*(1-q*.4),r*.028*(.5+level),aa+Math.PI*.5,0,TAU);c.fill();}
        c.fillStyle=rgba('#fff9e5',.45+level*.55);c.shadowColor='#fff1c0';c.shadowBlur=v.phosphor*(17+level*22);c.beginPath();c.ellipse(hx,hy,r*(.055+level*.11),r*.026*(.6+level),head+Math.PI*.5,0,TAU);c.fill();
        c.fillStyle='#fffdf1';c.beginPath();c.ellipse(hx,hy,r*(.035+level*.07),r*.012*(.6+level),head+Math.PI*.5,0,TAU);c.fill();
      }else{c.fillStyle=rgba('#fff2bc',.2+level*.6);c.beginPath();c.arc(hx,hy,2+level*2,0,TAU);c.fill();}
    }
    c.shadowBlur=0;c.restore();
    const p=polarMapping(selectedPos.nx,selectedPos.ny,w/h,h),a=p.angle-Math.PI*.5,rr=p.r*r,px=x+Math.cos(a)*rr,py=y+Math.sin(a)*rr;
    c.strokeStyle=rgba('#fff3db',.9);c.lineWidth=.8;c.beginPath();c.arc(px,py,7,0,TAU);c.stroke();line(c,[[px-12,py],[px+12,py]],rgba('#fff3db',.6),.7);line(c,[[px,py-12],[px,py+12]],rgba('#fff3db',.6),.7);
    c.fillStyle=v.polarColour;c.beginPath();c.arc(x,y,3,0,TAU);c.fill();
  }
  function phaseTrace(w,h,v,snap,t){
    const count=Math.round(v.phaseSamples),layers=Math.round(v.phaseSlices),ratio=api.state.sound.ratio,index=api.state.sound.index,cx=w*.765,pg=polarGeometry(w,h),cy=pg.y;
    const ca=Math.cos(v.phaseAngle),sa=Math.sin(v.phaseAngle),ct=Math.cos(v.phaseTilt),st=Math.sin(v.phaseTilt),sx=w*.165/Math.max(1,Math.abs(ca)+v.phaseDepth*1.25*Math.abs(sa)),sy=(pg.bottom-pg.top)*.27,depth=Math.min(sx,sy)*v.phaseDepth;
    const zBound=depth*(.46+.625*Math.min(1.5,v.phaseDelay/.025)),xBound=sx*Math.abs(ca)+zBound*Math.abs(sa),yBound=sy*Math.abs(ct)+(zBound*Math.abs(ca)+sx*Math.abs(sa))*Math.abs(st),fit=Math.min(1,w*.205/Math.max(1,xBound),(pg.bottom-pg.top)*.42/Math.max(1,yBound));
    const active=snap.voices.filter(n=>n.level>.005).sort((a,b)=>b.started-a.started),voice=active.find(n=>n.midi===selected)||active[0],rms=clamp(snap.rms*5,0,1),phase=voice?(snap.time-voice.started)*TAU*440*Math.pow(2,(voice.midi-69)/12):0;let n=0;
    if(renderer){material.uniforms.colour.value.set(v.phaseColour);material.uniforms.glow.value=v.phosphor;material.uniforms.size.value=v.phaseDotSize*Math.min(devicePixelRatio||1,1.6)*(1+v.phosphor*.9);}
    // A time-delay embedding: X is the current carrier; each plane samples
    // the modulator and quadrature carrier at an older, explicit phase lag.
    // The depth dimension separates these measured relationships, rather
    // than decorating a single curve with unrelated particle positions.
    for(let layer=layers-1;layer>=0;layer--){
      if(layer>0&&v.persistence===0)continue;
      const fraction=layer/Math.max(1,layers-1),lag=layer*v.phaseDelay*TAU,strength=layer===0?.92+rms*.08:v.persistence*(.3+.55*(1-fraction)),plane=depth*(fraction-.5)*1.25*Math.min(1.5,v.phaseDelay/.025);
      for(let i=0;i<count;i++){
        const theta=i/(count-1)*TAU*4+phase,current=phasePoint(theta,ratio,index,api.state.sound.waveform),past=layer?phasePoint(theta-lag,ratio,index,api.state.sound.waveform):current;
        const xx=current.carrier*sx,yy=past.mod*sy,zz=past.quadrature*depth*.46+plane,xr=xx*ca+zz*sa,zr=zz*ca-xx*sa,yr=yy*ct-zr*st;
        const pitch=v.phasePitch||4,x=Math.round((cx+xr*fit)/pitch)*pitch,y=Math.round((cy-yr*fit)/pitch)*pitch;
        if(renderer){positions[n*3]=x-w/2;positions[n*3+1]=h/2-y;positions[n*3+2]=zr*ct+yy*st;alpha[n]=strength*(.8+.2*i/count);shade[n]=1-fraction*.88;n++;}
        else{c.fillStyle=rgba(v.phaseColour,strength*(.6+.4*i/count));const r=v.phaseDotSize*.5;c.fillRect(x-r,y-r,r*2,r*2);}
      }
    }
    if(renderer){geometry.setDrawRange(0,n);geometry.attributes.position.needsUpdate=true;geometry.attributes.alpha.needsUpdate=true;geometry.attributes.shade.needsUpdate=true;renderer.render(scene,camera);}
  }
  function envelope(w,h,v,snap){
    const sound=api.state.sound,x=22,y=h-64,width=w*.43,height=20,sum=sound.attack+sound.decay+.35+sound.release;
    const ax=x+width*sound.attack/sum,dx=ax+width*sound.decay/sum,sx=dx+width*.35/sum;
    line(c,[[x,y+height],[ax,y],[dx,y+height*(1-sound.sustain)],[sx,y+height*(1-sound.sustain)],[x+width,y+height]],rgba(v.polarColour,.4),.9);
    label(c,`A ${(sound.attack*1000).toFixed(0)} ms`,x,y-8,rgba(v.polarColour,.5),8);label(c,`R ${sound.release.toFixed(2)} s`,x+width,y-8,rgba(v.polarColour,.5),8,'right');
    const waveform=snap.waveform||[];if(waveform.length){const points=[];for(let i=0;i<180;i++){const value=waveform[Math.floor(i/180*waveform.length)]||0;points.push([w*.55+i/180*w*.415,h-53-value*24]);}line(c,points,rgba(v.phaseColour,.55),.8);}
  }
  return{
    frame(t,dt){surface.resize();const w=surface.width,h=surface.height,v={...definition.defaultAppearance,...api.state.appearance},snap=api.audio.snapshot();c.clearRect(0,0,w,h);
      if(renderer&&(lastW!==w||lastH!==h)){renderer.setSize(w,h,false);camera.left=-w/2;camera.right=w/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();lastW=w;lastH=h;}
      if(!contacts.size){const sounding=snap.voices.filter(v=>v.level>.001).sort((a,b)=>b.started-a.started)[0];if(sounding){selected=sounding.midi;octave=Math.floor((selected-api.state.root)/12);for(let i=0;i<7;i++)if(((api.quantize(i)-selected)%12+12)%12===0){degree=i;break;}}}const plot=plots(w,h,v);radialTrace(w,h,v,snap,t,plot);phaseTrace(w,h,v,snap,t);envelope(w,h,v,snap);
      const small=w<650;label(c,'θ PITCH · r OCTAVE',22,23,rgba(v.polarColour,.6),small?8:10);label(c,api.noteName(selected),22,48,v.polarColour,small?21:29);label(c,`${(440*Math.pow(2,(selected-69)/12)).toFixed(2)} Hz`,w*.47,48,rgba(v.polarColour,.65),small?9:12,'right');
      label(c,'X RATIO · Y INDEX',w*.55,23,rgba(v.phaseColour,.6),small?8:10);label(c,`${api.state.sound.ratio.toFixed(2)} : 1`,w*.55,48,v.phaseColour,small?19:27);label(c,`I ${api.state.sound.index.toFixed(2)}`,w-22,48,rgba(v.phaseColour,.65),small?10:13,'right');
      label(c,`DEG ${degree+1}  OCT ${octave>=0?'+':''}${octave}`,22,h-20,rgba(v.polarColour,.5),9);label(c,`RMS ${snap.rms.toFixed(3)}`,w-22,h-20,rgba(v.phaseColour,.5),9,'right');
    },
    onStep(step,when){const melody=[0,4,2,6,3,5,1,4],midi=api.quantize(melody[step%8],step%4===3?1:0);api.audio.pulse('polar-step-'+step,midi,soundOptions(),when,60/api.state.bpm*.43);},
    update(){api.audio.configure(api.state.sound);},
    cancel(){for(const[id,q]of contacts)if(q.ownsVoice)api.noteOff('polar-'+id);contacts.clear();},
    destroy(){unbind();for(const[id,q]of contacts)if(q.ownsVoice)api.noteOff('polar-'+id);contacts.clear();if(renderer){geometry.dispose();material.dispose();renderer.dispose();renderer.forceContextLoss();}surface.destroy();wrapper.remove();}
  };
}
