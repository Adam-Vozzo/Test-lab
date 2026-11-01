// The same finite Fourier table drives the oscillator and its plotted surface.
// Tables are bounded and cached; no generated audio leaves the browser.
const TAU=Math.PI*2,cache=new Map();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:a));
export function wavetableCoefficients(position=.35,warp=0,harmonics=64){
  const p=Math.round(clamp(position,0,1)*256)/256,w=Math.round(clamp(warp,0,1)*256)/256,n=Math.round(clamp(harmonics,8,128)),key=`${p}:${w}:${n}`;
  if(cache.has(key))return cache.get(key);
  const real=new Float32Array(n+1),imag=new Float32Array(n+1),blend=p*4,lo=Math.min(3,Math.floor(blend)),f=blend-lo;
  function partial(frame,k){
    if(frame===0)return k===1?1:0;
    if(frame===1)return k%2?8/Math.PI**2*(k%4===1?1:-1)/(k*k):0;
    if(frame===2)return 2/Math.PI*(k%2?1:-1)/k;
    if(frame===3)return k%2?4/Math.PI/k:0;
    return (k===1?.65:0)+Math.sin(k*.93)*Math.exp(-(((k-7)/4.8)**2))/Math.sqrt(k);
  }
  let bound=0;
  for(let k=1;k<=n;k++){
    const taper=.5+.5*Math.cos(Math.PI*k/(n+1)),amplitude=(partial(lo,k)*(1-f)+partial(lo+1,k)*f)*taper;
    const colour=1+w*1.4*Math.exp(-(((k-(3+w*14))/3.5)**2)),phase=w*.85*Math.sin(k*.47);
    real[k]=amplitude*colour*Math.sin(phase);imag[k]=amplitude*colour*Math.cos(phase);bound+=Math.abs(amplitude*colour);
  }
  const scale=.88/Math.max(1,bound);for(let k=1;k<=n;k++){real[k]*=scale;imag[k]*=scale;}
  const value={real,imag,key};cache.set(key,value);if(cache.size>64)cache.delete(cache.keys().next().value);return value;
}
export function wavetableSample(phaseRadians,position=.35,warp=0){
  const {real,imag}=wavetableCoefficients(position,warp);let sample=0;
  const phase=Number.isFinite(phaseRadians)?phaseRadians%TAU:0;
  for(let k=1;k<real.length;k++)sample+=real[k]*Math.cos(k*phase)+imag[k]*Math.sin(k*phase);
  return sample;
}
