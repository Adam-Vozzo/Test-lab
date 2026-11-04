import test from 'node:test';
import assert from 'node:assert/strict';
import {BlobVolume} from '../instruments/blob-volume.js';

// Check the actual implicit field, not just the line used to join its centres.
function components(volume){
 const {field,size,isolation}=volume.mesh,n=field.length,seen=new Uint8Array(n),queue=new Uint32Array(n),plane=size*size;let count=0;
 for(let i=0;i<n;i++){if(seen[i]||field[i]<=isolation)continue;count++;let begin=0,end=1;queue[0]=i;seen[i]=1;while(begin<end){const at=queue[begin++],x=at%size,y=Math.floor(at/size)%size,z=Math.floor(at/plane);for(const next of [x>0?at-1:-1,x<size-1?at+1:-1,y>0?at-size:-1,y<size-1?at+size:-1,z>0?at-plane:-1,z<size-1?at+plane:-1])if(next>=0&&!seen[next]&&field[next]>isolation){seen[next]=1;queue[end++]=next;}}}
 return count;
}

test('A dense scattered gesture remains one connected finite volume within the mesh budget',()=>{
 const volume=new BlobVolume({resolution:46,connected:true});
 try{let seed=19;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;},points=Array.from({length:96},(_,i)=>({x:40+random()*1060,y:90+random()*340,z:random()*60-30,r:12+random()*20,color:['#f18c3c','#86cfb2','#b37ddd'][i%3]}));volume.update(points,1180,760,1);assert.equal(components(volume),1);assert.ok(volume.mesh.count>0&&volume.mesh.count<=18000*3);const {position,color}=volume.mesh.geometry.attributes;for(let i=0;i<volume.mesh.count*3;i++){assert.ok(Number.isFinite(position.array[i]));assert.ok(color.array[i]>=0&&color.array[i]<=1);}}
 finally{volume.dispose();}
});

test('Reduced ambient motion retains live geometry updates when controls or viewport move',()=>{
 const volume=new BlobVolume({resolution:46});
 try{const point={x:200,y:140,r:35,color:'#eaa55e'};volume.update([point],800,600,1,{motion:0});const before=volume.mesh.position.x,geometry=volume.mesh.positionArray.slice();volume.update([point],800,600,1.5,{motion:0});assert.deepEqual(volume.mesh.positionArray,geometry);volume.update([{...point,x:340}],800,600,2,{motion:0});assert.equal(volume.mesh.position.x-before,140);volume.update([{...point,x:340}],1000,600,3,{motion:0});assert.equal(volume.mesh.position.x-before,40);volume.update([],1000,600,4,{motion:0});assert.equal(volume.mesh.visible,false);}
 finally{volume.dispose();}
});

test('Oversubscribed animated input retains finite geometry within every allocated attribute',()=>{
 const volume=new BlobVolume({resolution:46,connected:true});
 const points=Array.from({length:120},(_,i)=>({x:40+(i*163.733%1000),y:60+(i*61.73%360),r:22+(i%3)*6,color:['#eeaa33','#77aaaa','#ffaaee'][i%3]}));
 try{for(const time of [0,.5,2]){volume.update(points,1200,800,time);const count=volume.mesh.geometry.drawRange.count;assert.ok(count>0);assert.equal(count%3,0);for(const name of ['position','normal','color']){const attribute=volume.mesh.geometry.attributes[name];assert.ok(count<=attribute.count);for(let i=0;i<count*attribute.itemSize;i++)assert.ok(Number.isFinite(attribute.array[i]),`${name}[${i}]`);}}}
 finally{volume.dispose();}
});
