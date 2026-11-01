/** Collection module contract. Each instrument exports `definition` and `mount`.
 *
 * definition = {
 *   id:'carrier', name:'Carrier / Modulator', batch:1,
 *   theme:{bg:'#f1eee5',fg:'#292827',accent:'#ec6855',muted:'#77736c'},
 *   defaultSound:{waveform:'sine',attack:.02,release:.6,cutoff:6000,ratio:2,index:1},
 *   defaultAppearance:{density:1},
 *   soundControls:[{key:'ratio',label:'Modulator ratio',min:.25,max:8,step:.25,unit:'×',section:'Modulation',description:'Frequency relative to the carrier.'}],
 *   appearanceControls:[{key:'density',label:'Guide density',min:.5,max:2,step:.1,section:'Guides',description:'Spacing of the radial guide dots.'}],
 * };
 * Controls default to kind:'range'. Other kinds: select (options:[[value,label]]),
 * color, toggle. Every control must have a visible effect or an audio meaning.
 *
 * mount(host,api) returns {frame(tSeconds,dtSeconds),onStep(step,when),
 *   update?(key,kind),cancel?(),destroy(),getData?(),setData?(data)}.
 * Host owns RAF, transport, instrument switching, settings, persistence.
 * Modules own their artwork, playing gestures and their sequencer model.
 * `onStep` is called on the audio look-ahead clock; use `when` for audio.pulse.
 * Do not display a look-ahead step early: use api.audio.snapshot().step.
 *
 * api.state = {bpm,root,scale,playing,hold,arp,arpRate,sound,appearance}.
 * api.audio: CollectionAudio (see collection-audio.js).
 * api.noteOn(id,midi,options), noteUpdate(id,midi,options), noteOff(id)
 * forward to audio with the current sound settings. Hold/Arp are owned by audio.
 * api.quantize(degree,octave=0) returns a MIDI note in the selected root/scale.
 * api.noteName(midi), api.save(), api.setStatus(text), api.toast(text).
 * api.setSound(patch) updates sound parameters, sounding/latched voices,
 * visible controls and persistence. Prefer it for gesture-driven parameters.
 * definition.commonSoundControls=false hides the standard oscillator/ADSR
 * controls for engines such as granular; supply actual custom controls instead.
 * `api.audio.snapshot()` = {time,rms,step,voices:[{id,midi,level,gate}],waveform,frequency}.
 * `api.audio.pulse(id,midi,options,when,duration)` schedules a bounded note.
 * options include waveform,attack,decay,sustain,release,cutoff,resonance,
 * gain,pan,ratio,index,detune,crush. Exact options supported by audio module.
 * All gestures are local to the instrument; capture pointer IDs independently.
 * Cancel must release local contacts. No automatic audio playback on mount.
 *
 * kit.js provides: TAU,clamp,lerp,rgba,seeded,noteName,createSurface(host,{label,bg}),
 * bindPointers(canvas,{down,move,up,cancel}),label(ctx,text,x,y,color,size=10,align='left'),
 * line(ctx,points,color,width=1),roundedRect(ctx,x,y,w,h,r).
 * createSurface returns {canvas,ctx,width,height,dpr,resize(),destroy()} with
 * CSS pixel coordinates and a DPR-scaled drawing transform. Call resize in frame;
 * it changes backing storage only when dimensions change. Clear in CSS pixels.
 * bindPointers supplies {id,x,y,nx,ny,pressure,event}; down false declines capture.
 * Three.js can be imported from ../vendor/three.module.min.js for real 3D.
 *
 * No global DOM IDs or shared CSS edits from instrument modules. Inline scoped
 * module CSS/classes are allowed. Reuse only geometry/utilities that are shared
 * in behavior; every instrument must retain its own reference composition.
 */
export const COLLECTION_SCHEMA = 1;
