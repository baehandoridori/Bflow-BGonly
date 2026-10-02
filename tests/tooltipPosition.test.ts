import test from 'node:test';
import assert from 'node:assert/strict';
import { placeFollowTooltip } from '../src/utils/tooltipPosition.ts';

// 움직임 폴리싱 2번(tooltip-anchor)에서 cursorTooltipAnchor(가운데·아래 끝 기준점)를
// placeFollowTooltip(상자 왼쪽 위 모서리)으로 바꿨다. 같은 장면을 그대로 확인한다.
test('cursor tooltip stays inside every viewport edge with its measured size',()=>{
  for(const point of [{x:0,y:0},{x:1279,y:0},{x:0,y:719},{x:1279,y:719},{x:600,y:300}]){
    const box=placeFollowTooltip(point,{width:260,height:140},{width:1280,height:720});
    assert.ok(box.left>=8);assert.ok(box.left+260<=1272);
    assert.ok(box.top>=8);assert.ok(box.top+140<=712);
  }
});

test('cursor tooltip switches below the pointer near the top',()=>{
  const above=placeFollowTooltip({x:400,y:300},{width:240,height:100},{width:800,height:600});
  const below=placeFollowTooltip({x:400,y:20},{width:240,height:100},{width:800,height:600});
  // 위: 상자 아래 끝이 커서 12px 위 / 아래: 상자 위 끝이 커서 16px 아래. 가로는 커서 가운데.
  assert.equal(above.top+100,288);assert.equal(above.below,false);assert.equal(above.left,280);
  assert.equal(below.top,36);assert.equal(below.below,true);assert.equal(below.left,280);
});
