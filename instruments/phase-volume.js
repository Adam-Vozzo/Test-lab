import * as THREE from '../vendor/three.module.min.js';
import {TAU,clamp,lerp,rgba,createSurface,bindPointers,label,line} from './kit.js';

export const definition={
  id:'phase-volume',name:'Phase Volume',batch:4,layoutMode:'single',
  theme:{bg:'#05070a',fg:'#f2f4ee',accent:'#a8dfff',muted:'#8c949c'},
  defaultSound:{waveform:'sawtooth',attack:.012,decay:.3,sustain:.6,release:1.3,cutoff:10000,resonance:1,gain:.3,ratio:1.5,index:.75,glide:.035,echo:.15},
  defaultAppearance:{guideOpacity:.7,phosphor:.85,persistence:.7,phaseSamples:1050,phaseDotSize:2.6,phasePitch:4,phaseDepth:.85,phaseAngle:-.48,phaseTilt:.55,phaseSlices:12,phaseDelay:.025,phaseColour:'#a8dfff',background:'#05070a'},
  soundControls:[
    {key:'ratio',label:'Frequency ratio',min:.25,max:8,step:.25,unit:'×',section:'Oscillator relationship',description:'Modulator/carrier ratio; also the horizontal axis of the playing surface.'},
    {key:'index',label:'Modulation index',min:0,max:10,step:.05,section:'Oscillator relationship',description:'FM depth, shown by deformation of the phase-space trace.'},
    {key:'glide',label:'Pitch glide',min:.003,max:.3,step:.005,unit:'s',section:'Voice',description:'Pitch transition time between held keyboard notes.'}
  ],
  appearanceControls:[
    {key:'guideOpacity',label:'Axis grid opacity',min:.05,max:.8,step:.01,section:'Plot',description:'Visibility of the phase axes and grid.'},
    {key:'phosphor',label:'Phosphor glow',min:0,max:1.5,step:.05,section:'Phosphor',description:'Local glow around each phase-volume dot.'},
    {key:'persistence',label:'Trace persistence',min:0,max:1,step:.05,section:'Phosphor',description:'Visibility of delayed signal slices behind the current carrier/modulator curve.'},
    {key:'phaseSamples',label:'Phase samples',min:200,max:1400,step:50,section:'Phase plot',description:'Number of points used to plot the carrier/modulator relationship.'},
    {key:'phaseDotSize',label:'Phase dot size',min:.6,max:3.5,step:.1,unit:'px',section:'Phase plot',description:'Size of individual points in the blue phase plot.'},
    {key:'phasePitch',label:'Phase grid pitch',min:2,max:10,step:.5,unit:'px',section:'Phase plot',description:'Spacing of the fixed dot grid used to sample the phase-space figure.'},
    {key:'phaseDepth',label:'Phase depth',min:0,max:1,step:.05,section:'Phase plot',description:'Separation of time-delay slices and quarter-cycle carrier depth.'},
    {key:'phaseSlices',label:'Depth slices',min:2,max:16,step:1,section:'Phase plot',description:'Number of delayed carrier/modulator sample planes in the volume.'},
    {key:'phaseDelay',label:'Slice delay',min:0,max:.08,step:.005,unit:'cyc',section:'Phase plot',description:'Time lag between carrier and modulator samples in successive depth slices, measured in carrier cycles.'},
    {key:'phaseTilt',label:'Plot tilt',min:-1.2,max:1.2,step:.05,unit:'rad',section:'Phase plot',description:'Vertical viewing angle that reveals separation between delayed sample planes.'},
    {key:'phaseAngle',label:'Plot rotation',min:-1.5,max:1.5,step:.05,unit:'rad',section:'Phase plot',description:'Viewing angle of the phase-space figure; does not change pitch.'},
    {key:'phaseColour',label:'Phase colour',kind:'color',section:'Palette',description:'Colour of the dotted carrier/modulator plot.'},
    {key:'background',label:'Plot background',kind:'color',section:'Palette',description:'Background colour of the phase-volume surface.'}
  ]
};

function plotGeometry(width,height){const top=64,bottom=Math.max(top+55,height-80);return{y:(top+bottom)/2,top,bottom};}
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
  const surface=createSurface(wrapper,{label:'Phase volume. Drag horizontally for frequency ratio and vertically for modulation index. Keyboard notes select pitch.'});surface.canvas.style.cssText+='position:relative;z-index:2;';const c=surface.ctx,contacts=new Map();
  let renderer=null,scene,camera,points,geometry,material,positions,alpha,shade,pointColor,lastW=0,lastH=0,selected=api.quantize(0),lastPlotKey='';
  const maxSamples=1400,maxPoints=maxSamples*16;
  try{
    renderer=new THREE.WebGLRenderer({alpha:true,premultipliedAlpha:true,antialias:false,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.domElement.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';wrapper.insertBefore(renderer.domElement,surface.canvas);
    scene=new THREE.Scene();camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,2000);camera.position.z=700;
    geometry=new THREE.BufferGeometry();positions=new Float32Array(maxPoints*3);alpha=new Float32Array(maxPoints);shade=new Float32Array(maxPoints);geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('alpha',new THREE.BufferAttribute(alpha,1).setUsage(THREE.DynamicDrawUsage));geometry.setAttribute('shade',new THREE.BufferAttribute(shade,1).setUsage(THREE.DynamicDrawUsage));
    material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{colour:{value:new THREE.Color('#a8dfff')},size:{value:2},glow:{value:.5}},vertexShader:'attribute float alpha;attribute float shade;uniform float size;varying float a;varying float vShade;void main(){a=alpha;vShade=shade;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size;}',fragmentShader:'uniform vec3 colour;uniform float glow;varying float a;varying float vShade;void main(){vec2 q=abs(gl_PointCoord-.5)*2.;float r=length(q),core=1.-smoothstep(.42,.55,max(q.x,q.y)),halo=exp(-r*r*4.)*glow*.17;gl_FragColor=vec4(mix(colour*vec3(.32,.5,.92),mix(colour,vec3(1.),core*.4),vShade),min(.98,a*(core+halo)));\n#include <colorspace_fragment>\n}' });points=new THREE.Points(geometry,material);points.frustumCulled=false;scene.add(points);
  }catch{renderer?.dispose();renderer=null;}
  function modulate(p){api.setSound({ratio:Math.round(clamp((p.nx-.04)/.92,0,1)*31+1)/4,index:Math.round(clamp((.87-p.ny)/.75,0,1)*200)/20});}
  const soundOptions=()=>({...api.state.sound});
  const unbind=bindPointers(surface.canvas,{
    down:p=>{modulate(p);const ownsVoice=!contacts.size&&!api.audio.snapshot().voices.some(v=>v.level>.001);contacts.set(p.id,{ownsVoice,nx:p.nx,ny:p.ny});if(ownsVoice)api.noteOn('phase-'+p.id,selected,soundOptions());},
    move:p=>{const q=contacts.get(p.id);if(!q)return;Object.assign(q,{nx:p.nx,ny:p.ny});modulate(p);},
    up:p=>{if(contacts.get(p.id)?.ownsVoice)api.noteOff('phase-'+p.id);contacts.delete(p.id);api.save();},
    cancel:p=>{if(contacts.get(p.id)?.ownsVoice)(api.noteCancel||api.noteOff)('phase-'+p.id);contacts.delete(p.id);}
  });
  function plots(w,h,v){
    const key=JSON.stringify([w,h,surface.dpr,v.background,v.phaseColour,v.guideOpacity]);if(key===lastPlotKey)return;lastPlotKey=key;
    baseCanvas.width=Math.round(w*surface.dpr);baseCanvas.height=Math.round(h*surface.dpr);bg.setTransform(surface.dpr,0,0,surface.dpr,0,0);
    bg.fillStyle=v.background;bg.fillRect(0,0,w,h);const q=plotGeometry(w,h),x=22,y=q.top,pw=w-44,ph=q.bottom-q.top;
    bg.strokeStyle=rgba(v.phaseColour,.28);bg.lineWidth=.7;bg.strokeRect(x,y,pw,ph);
    for(let i=0;i<=12;i++)line(bg,[[x+pw*i/12,y],[x+pw*i/12,y+ph]],rgba(v.phaseColour,v.guideOpacity*.08),.5);
    for(let i=0;i<=8;i++)line(bg,[[x,y+ph*i/8],[x+pw,y+ph*i/8]],rgba(v.phaseColour,v.guideOpacity*.08),.5);
    line(bg,[[x,q.y],[x+pw,q.y]],rgba(v.phaseColour,.3),.7);line(bg,[[w/2,y],[w/2,y+ph]],rgba(v.phaseColour,.3),.7);
    label(bg,'CARRIER',x+8,q.y-9,rgba(v.phaseColour,.6),9);label(bg,'MODULATOR',w/2+8,y+16,rgba(v.phaseColour,.6),9);
  }
  function phaseTrace(w,h,v,snap,t){
    const count=Math.round(v.phaseSamples),layers=Math.round(v.phaseSlices),ratio=api.state.sound.ratio,index=api.state.sound.index,cx=w*.5,pg=plotGeometry(w,h),cy=pg.y;
    const ca=Math.cos(v.phaseAngle),sa=Math.sin(v.phaseAngle),ct=Math.cos(v.phaseTilt),st=Math.sin(v.phaseTilt),sx=Math.min(w*.36,(pg.bottom-pg.top)*.52)/Math.max(1,Math.abs(ca)+v.phaseDepth*1.25*Math.abs(sa)),sy=(pg.bottom-pg.top)*.32,depth=Math.min(sx,sy)*v.phaseDepth;
    const zBound=depth*(.46+.625*Math.min(1.5,v.phaseDelay/.025)),xBound=sx*Math.abs(ca)+zBound*Math.abs(sa),yBound=sy*Math.abs(ct)+(zBound*Math.abs(ca)+sx*Math.abs(sa))*Math.abs(st),fit=Math.min(1,w*.44/Math.max(1,xBound),(pg.bottom-pg.top)*.42/Math.max(1,yBound));
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
  return{
    frame(t,dt){surface.resize();const w=surface.width,h=surface.height,v={...definition.defaultAppearance,...api.state.appearance},snap=api.audio.snapshot();c.clearRect(0,0,w,h);
      if(renderer&&(lastW!==w||lastH!==h)){renderer.setSize(w,h,false);camera.left=-w/2;camera.right=w/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();lastW=w;lastH=h;}
      const sounding=snap.voices.filter(v=>v.level>.001).sort((a,b)=>b.started-a.started)[0];if(sounding)selected=sounding.midi;
      plots(w,h,v);phaseTrace(w,h,v,snap,t);
      label(c,'PHASE VOLUME / DELAY EMBEDDING',22,20,rgba(v.phaseColour,.65),w<600?8:10);
      label(c,`${api.state.sound.ratio.toFixed(2)} : 1`,22,47,v.phaseColour,w<600?22:29);label(c,`I ${api.state.sound.index.toFixed(2)}`,w-22,47,v.phaseColour,16,'right');
      for(const q of contacts.values()){const x=q.nx*w,y=q.ny*h;c.strokeStyle=rgba(v.phaseColour,.8);c.lineWidth=.7;c.beginPath();c.arc(x,y,9,0,TAU);c.stroke();line(c,[[x-15,y],[x+15,y]],rgba(v.phaseColour,.4));line(c,[[x,y-15],[x,y+15]],rgba(v.phaseColour,.4));}
      const scope=snap.waveform||[],trace=[];for(let i=0;i<160;i++)trace.push([22+i/159*(w-44),h-43-(scope[Math.floor(i/160*scope.length)]||0)*24]);line(c,trace,rgba(v.phaseColour,.55),.8);
      label(c,`${api.noteName(selected)} / ${(440*2**((selected-69)/12)).toFixed(1)} Hz`,22,h-15,rgba(v.phaseColour,.7),9);label(c,`${Math.round(v.phaseSlices)} SLICES · RMS ${snap.rms.toFixed(3)}`,w-22,h-15,rgba(v.phaseColour,.55),9,'right');
    },
    onStep(step,when){const melody=[0,4,2,6,3,5,1,4],midi=api.quantize(melody[step%8],step%4===3?1:0);api.audio.pulse('phase-step-'+step,midi,soundOptions(),when,60/api.state.bpm*.43);},
    update(){api.audio.configure(api.state.sound);},
    cancel(){for(const[id,q]of contacts)if(q.ownsVoice)(api.noteCancel||api.noteOff)('phase-'+id);contacts.clear();},
    destroy(){unbind();for(const[id,q]of contacts)if(q.ownsVoice)(api.noteCancel||api.noteOff)('phase-'+id);contacts.clear();if(renderer){geometry.dispose();material.dispose();renderer.dispose();renderer.forceContextLoss();}surface.destroy();wrapper.remove();}
  };
}
