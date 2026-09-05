import test from 'node:test';
import assert from 'node:assert/strict';
import { cursorTooltipAnchor } from '../src/utils/tooltipPosition.ts';

test('cursor tooltip stays inside every viewport edge with its measured size',()=>{
  for(const point of [{x:0,y:0},{x:1279,y:0},{x:0,y:719},{x:1279,y:719},{x:600,y:300}]){
    const anchor=cursorTooltipAnchor(point,{width:260,height:140},{width:1280,height:720});
    assert.ok(anchor.left-130>=8);assert.ok(anchor.left+130<=1272);
    assert.ok(anchor.top-140>=8);assert.ok(anchor.top<=712);
  }
});

test('cursor tooltip switches below the pointer near the top without changing the anchor transform',()=>{
  const above=cursorTooltipAnchor({x:400,y:300},{width:240,height:100},{width:800,height:600});
  const below=cursorTooltipAnchor({x:400,y:20},{width:240,height:100},{width:800,height:600});
  assert.equal(above.top,288);assert.equal(below.top-100,36);
});
