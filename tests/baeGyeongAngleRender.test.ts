import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// BAE경 '다른 각도로' 밑그림이 HTML v0.4.11 과 같은지 (7단계 끝 기준 '밑그림이 HTML 과 같음: 색 차이와 회색 자리').
// 그리는 판(WebGL2)은 node 에서 돌지 않으므로, 앱과 같은 엔진(Electron 33.4.11, Chromium 130)의 화면 밖 창에서 견준 값을 견본에 남겨 두고 여기서 본다
// (C:\BAE_stage0\angle_port\harness\capture_angle.mjs: 같은 그림 · 같은 깊이 값 · 같은 카메라로 HTML 페이지와 Bflow 판을 각각 그려 픽셀 비교).
//   view   = 창의 'B에서 본 입체 판' (960×540, 같은 공간 그림이 있으면 합친 그림, 밑면 포함)
//   images = GPT 에게 가는 그림 (1번 = 밑그림 1536 폭 + 붓, 2번 = 원래 그림 · 가까이면 그 부분, 3번~ = 같은 공간 그림)
// 회색 자리 = (128, 128, 128) ± 1 인 픽셀, 겹침은 IoU. HTML 의 실험 기준은 색 차이 0.06/255 · 회색 자리 일치 1.000 (09 문서 5장).
const data = JSON.parse(fs.readFileSync('tests/fixtures/bae/angle/cases.json', 'utf8')) as { engine: { electron: string; chrome: string }; cases: Record<string, any> };

test('견본은 앱과 같은 엔진(Electron 33, Chromium 130)에서 받았다', () => {
  assert.match(data.engine.electron, /^33\./); assert.match(data.engine.chrome, /^130\./);
});
for (const [id, cs] of Object.entries(data.cases)) {
  test(`${id}: B에서 본 입체 판이 HTML 과 같다 (색 차이 · 회색 자리)`, () => {
    const v = cs.render.view;
    assert.equal(v.w, 960); assert.equal(v.h, 540);
    assert.ok(v.mean <= 0.06, `평균 색 차이 ${v.mean}`);
    assert.equal(v.greyIoU, 1, '회색 자리가 같아야 해요');
    assert.equal(v.greyA, v.greyB);
  });
  if (cs.setup.refuse) continue;
  test(`${id}: GPT 에게 가는 밑그림이 HTML 과 바이트까지 같다`, () => {
    const g = cs.render.images[0];
    assert.equal(g.same, true); assert.equal(g.mean, 0); assert.equal(g.greyIoU, 1);
    const f = cs.html.image[0].fields.find((x: any) => x.filename === 'image1.png');
    assert.equal(f.format, 'png'); assert.equal(Math.max(f.width, f.height), 1536);
  });
  test(`${id}: 원래 그림 · 같은 공간 그림도 HTML 과 같다 (캔버스 줄이기의 1단계 흔들림 안)`, () => {
    for (const r of cs.render.images.slice(1)) {
      assert.ok(r.same || (r.max <= 1 && r.diffPx / (r.w * r.h) < 1e-4), JSON.stringify(r));
      assert.equal(r.greyIoU, 1);
    }
    assert.equal(cs.render.images.length, cs.html.image[0].fields.filter((x: any) => x.filename).length);
  });
}
test('새로 그릴 곳(회색 · 늘어난 곳 · 밑면)을 재는 값이 HTML 과 같고, 밑면 장면은 2% 를 넘는다', () => {
  for (const cs of Object.values(data.cases)) assert.deepEqual(cs.ts.unseen, cs.html.unseen, cs.setup.id);
  assert.ok(data.cases.under.html.unseen.under >= 0.02);
  assert.ok(data.cases.btn_right45.html.unseen.grey > data.cases.btn_left20.html.unseen.grey, '실외 45° 는 회색이 많다');
});
