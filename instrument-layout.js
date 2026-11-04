const finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export const SHARED_APPEARANCE_DEFAULTS=Object.freeze({layoutGap:16,leftWidth:50,rightWidth:50,sceneBlur:0,sceneGrain:0,sceneGrainSize:1});
export const SHARED_APPEARANCE_CONTROLS=Object.freeze([
  {key:'layoutGap',label:'Minimum centre gap',min:0,max:120,step:1,unit:'px',section:'Layout',description:'Minimum space between the two playing surfaces. Their outside edges stay anchored.'},
  {key:'leftWidth',label:'Left surface width',min:20,max:80,step:1,unit:'%',section:'Layout',description:'Preferred share of the usable width, anchored left. Shares over 100% are fitted together; in portrait this sets the top surface height.'},
  {key:'rightWidth',label:'Right surface width',min:20,max:80,step:1,unit:'%',section:'Layout',description:'Preferred share of the usable width, anchored right. Smaller shares open more centre space; in portrait this sets the bottom surface height.'},
  {key:'sceneBlur',label:'Scene blur',min:0,max:6,step:.1,unit:'px',section:'Post-processing',description:'Softens the playing surfaces before grain. Footer controls and settings are excluded.'},
  {key:'sceneGrain',label:'Film grain',min:0,max:.35,step:.005,section:'Post-processing',description:'Monochrome grain mixed with soft light after blur, preserving dark and bright tones. Does not affect sound.'},
  {key:'sceneGrainSize',label:'Grain scale',min:.5,max:2.5,step:.1,section:'Post-processing',description:'Size of the film-grain texture. Has an effect when Film grain is above zero.'},
]);

/** One geometry source for both rendering and pointer hit tests. */
export function splitLayout(width,height,appearance={},options={}){
  const w=Math.max(1,finite(width,1)),h=Math.max(1,finite(height,1));
  const pad=clamp(finite(options.pad,12),0,Math.min(w,h)*.2);
  const wide=options.stackPortrait===false||w>=h*finite(options.portraitRatio,.95);
  const extent=(wide?w:h)-pad*2;
  const gap=clamp(finite(appearance.layoutGap,finite(options.gap,16)),0,Math.max(0,extent-2));
  const usable=Math.max(.001,extent-gap);
  let l=clamp(finite(appearance.leftWidth,50),20,80)/100,r=clamp(finite(appearance.rightWidth,50),20,80)/100;
  if(l+r>1){const total=l+r;l/=total;r/=total;}
  const left=wide?{x:pad,y:pad,w:usable*l,h:h-pad*2}:{x:pad,y:pad,w:w-pad*2,h:usable*l};
  const right=wide?{x:w-pad-usable*r,y:pad,w:usable*r,h:h-pad*2}:{x:pad,y:h-pad-usable*r,w:w-pad*2,h:usable*r};
  return{left,right,wide,gap:Math.max(0,wide?right.x-left.x-left.w:right.y-left.y-left.h)};
}

/** Clone module metadata; shared settings never mutate a module's defaults. */
export function withSharedAppearance(definition){
  const shared=SHARED_APPEARANCE_CONTROLS.filter(control=>definition.layoutMode!=='single'||control.section!=='Layout');
  const defaults=Object.fromEntries(shared.map(control=>[control.key,SHARED_APPEARANCE_DEFAULTS[control.key]]));
  const controls=new Map([...shared,...(definition.appearanceControls||[])].map(control=>[control.key,control]));
  // Instrument-specific groups remain first; shared controls follow them.
  const own=(definition.appearanceControls||[]).map(control=>control.key);
  const ordered=[...own,...[...controls.keys()].filter(key=>!own.includes(key))];
  return{...definition,defaultAppearance:{...defaults,...definition.defaultAppearance},appearanceControls:ordered.map(key=>controls.get(key))};
}
