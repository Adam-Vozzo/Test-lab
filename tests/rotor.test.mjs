import test from 'node:test';
import assert from 'node:assert/strict';
import {rotorLayout,rotorCoordinates,definition} from '../instruments/rotor.js';
import {TAU} from '../instruments/kit.js';
test('rotating pitch sectors use the same angle for touch and drawing',()=>{
 for(const phase of[0,.2,Math.PI,TAU-.01])for(const [w,h]of[[844,327],[1280,820],[390,740]]){
  const d=rotorLayout(w,h).pitch;
  for(let i=0;i<12;i++){const angle=-Math.PI/2+phase+(i+.5)/12*TAU,p={x:d.x+Math.cos(angle)*d.r*.9,y:d.y+Math.sin(angle)*d.r*.9};assert.equal(rotorCoordinates(p.x,p.y,d,phase).degree,i);}
 }
});
test('split surfaces remain in their panels and spectrum coordinates have intuitive direction',()=>{
 for(const [w,h]of[[844,327],[1280,820],[390,740]]){const l=rotorLayout(w,h);for(const d of[l.pitch,l.spectrum]){assert.ok(d.x-d.r>=0&&d.x+d.r<=w);assert.ok(d.y-d.r>=0&&d.y+d.r<=h);}const d=l.spectrum;assert.ok(rotorCoordinates(d.x+d.r*.5,d.y,d).nx>.5);assert.ok(rotorCoordinates(d.x,d.y-d.r*.5,d).ny<.5);}
});
test('all instrument-specific controls have bounded defaults',()=>{
 for(const [kind,controls]of[['Sound',definition.soundControls],['Appearance',definition.appearanceControls]])for(const control of controls){const value=definition['default'+kind][control.key];assert.notEqual(value,undefined,control.key);if(control.min!==undefined)assert.ok(value>=control.min&&value<=control.max,control.key);}
});
