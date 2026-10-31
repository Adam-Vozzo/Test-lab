import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {LOOKS,restoreSessionVisual,sanitiseVisual} from '../visual-config.js';

const previous = JSON.parse(await readFile(new URL('./fixtures/signal-revision-5.json',import.meta.url)));

test('untouched previous Signal sessions adopt the supplied default',()=>{
  const restored=restoreSessionVisual('signal',previous,5);
  assert.deepEqual(restored,LOOKS.signal.visual);
  assert.notStrictEqual(restored,LOOKS.signal.visual);
  assert.equal(restored.accent,'#e83b77');
  assert.equal(restored.secondary,'#ff0088');
  assert.equal(restored.strandCount,72);
  assert.equal(restored.ringRadius,1.93);
});

test('any saved visual edit preserves the entire custom look',()=>{
  for(const edit of [{scale:.81},{secondary:'#123456'},{matrixShape:'ascii'},{freeze:true},{sequenceTitle:'Pitch'}]){
    const custom={...previous,...edit};
    assert.deepEqual(restoreSessionVisual('signal',custom,5),custom);
  }
});

test('new sessions and resets use a valid complete default; revision 6 keeps deliberate old values',()=>{
  assert.deepEqual(restoreSessionVisual('signal',undefined,undefined),LOOKS.signal.visual);
  assert.deepEqual(sanitiseVisual(LOOKS.signal.visual,LOOKS.signal.visual),LOOKS.signal.visual);
  assert.deepEqual(restoreSessionVisual('signal',previous,6),previous);
});

test('other looks retain their appearance and invalid values remain sanitized',()=>{
  for(const name of ['ember','phosphor','vellum','ultraviolet'])
    assert.deepEqual(restoreSessionVisual(name,LOOKS[name].visual,5),LOOKS[name].visual);
  const restored=restoreSessionVisual('signal',{...previous,ringRadius:200,accent:'bad'},5);
  assert.equal(restored.ringRadius,2.3);
  assert.equal(restored.accent,LOOKS.signal.visual.accent);
});
