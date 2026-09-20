import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, nodes, text } from './helpers/calendarFormHarness.ts';

function choose(h: Awaited<ReturnType<typeof harness>>, label: string, value: string) {
  const select = nodes(h.render()).find(node => node.type === 'select' && node.props['aria-label'] === label);
  assert.ok(select, `select ${label}`); select.props.onChange({ target: { value } }); h.render();
}
test('monthly missing dates skip, custom weekly days and end conditions are previewed and validated', async () => {
  const h = await harness('EventCreateModal', { startDate: '2026-01-31', endDate: '2026-01-31' }); try {
    choose(h, '반복', 'monthly'); assert.ok(text(h.render()).includes('2026-03-31')); assert.equal(text(h.render()).includes('2026-02-28'), false);
    choose(h, '월 반복 방식', 'lastDay'); assert.ok(text(h.render()).includes('2026-02-28'));
    choose(h, '반복 종료', 'count'); h.type('반복 횟수', '0'); assert.equal(h.button('만들기').props.disabled, true); h.type('반복 횟수', '2'); assert.equal(h.button('만들기').props.disabled, false);
    choose(h, '반복 종료', 'date'); h.type('반복 종료일', '2025-12-31'); assert.equal(h.button('만들기').props.disabled, true);
    choose(h, '반복', 'weekly'); const sat = nodes(h.render()).find(node => node.props['aria-label'] === '토요일 반복'); sat.props.onClick(); h.render(); assert.equal(h.button('만들기').props.disabled, true);
    const monday = nodes(h.render()).find(node => node.props['aria-label'] === '월요일 반복'); monday.props.onClick(); h.render(); assert.equal(h.button('만들기').props.disabled, false); assert.ok(text(h.render()).includes('2026-02-02'));
  } finally { h.dispose(); }
});
for (const surface of ['EventQuickEdit', 'EventSidePanel'] as const) {
  test(`${surface}: one occurrence can move past the series end without changing its rule`, async () => {
    const h = await harness(surface, { recurrenceRule: { frequency: 'daily', interval: 1, until: '2026-09-20' }, recurrenceDate: '2026-09-20' }); try {
      h.type('종료일', '2026-09-21'); h.type('시작일', '2026-09-21'); assert.equal(h.button('저장').props.disabled, false);
      h.click('저장'); h.click('이 일정만'); assert.equal(h.calls[0].scope, 'this'); assert.equal(h.saved[0].startDate, '2026-09-21'); assert.equal('recurrenceRule' in h.saved[0], false);
    } finally { h.dispose(); }
  });
  test(`${surface}: delete asks scope and stale event or account cancels an open scope choice`, async () => {
    const h = await harness(surface, { recurrenceRule: { frequency: 'daily', interval: 1 } }, { openEdit: false }); try {
      h.click('삭제'); assert.equal(h.deleted.length, 0); h.click('전체 일정'); assert.equal(h.deleted[0].scope, 'all');
    } finally { h.dispose(); }
    const stale = await harness(surface, { recurrenceRule: { frequency: 'daily', interval: 1 } }); try {
      stale.type('제목', '오래된 초안'); stale.click('저장'); const confirm = stale.button('전체 일정'); stale.updateEvent({ title: '새 정본' }); confirm.props.onClick(); assert.equal(stale.saved.length, 0);
    } finally { stale.dispose(); }
    const account = await harness(surface, { recurrenceRule: { frequency: 'daily', interval: 1 } }); try {
      account.type('제목', '전 계정 초안'); account.click('저장'); const confirm = account.button('전체 일정'); account.setActor('new-actor'); confirm.props.onClick(); assert.equal(account.saved.length, 0);
    } finally { account.dispose(); }
  });
  test(`${surface}: recurring failed save retains detail draft and retry scope`, async () => {
    const h = await harness(surface, { recurrenceRule: { frequency: 'daily', interval: 1 } }, { onUpdate: async () => { throw new Error('offline'); } }); try {
      h.type('장소', '실패해도 남을 장소'); h.click('저장'); h.click('이 일정만'); await h.settle();
      assert.equal(h.input('장소').props.value, '실패해도 남을 장소'); assert.ok(text(h.render()).includes('저장에 실패')); h.click('저장'); h.click('전체 일정'); await h.settle(); assert.equal(h.calls[1].scope, 'all');
    } finally { h.dispose(); }
  });
  test(`${surface}: external and Gantt events do not expose native repetition fields`, async () => {
    for (const patch of [{ source: 'google', sourceCalendarId: 'google:calendar', calendarId: undefined }, { id: 'gantt:project:task', linkedGanttProjectId: 'project', linkedGanttTaskId: 'task' }, { canEdit: false, isReadOnly: true }]) {
      const h = await harness(surface, patch); try { assert.equal(nodes(h.render()).some(node => node.type === 'input' && node.props['aria-label'] === '장소'), false); } finally { h.dispose(); }
    }
  });
}
test('QuickEdit inline tags ask scope; calendar movement excludes this occurrence', async () => {
  const h = await harness('EventQuickEdit', { recurrenceRule: { frequency: 'daily', interval: 1 } }, { openEdit: false }); try {
    h.setCalendars([{ id: 'calendar', name: '원본', canEdit: true }, { id: 'destination', name: '목적지', canEdit: true }]);
    choose(h, '캘린더', 'destination'); assert.equal(h.saved.length, 0); assert.equal(nodes(h.render()).some(node => node.type === 'button' && text(node) === '이 일정만'), false);
    h.click('이후 일정'); await h.settle(); assert.equal(h.calls[0].scope, 'following'); assert.equal(h.saved[0].calendarId, 'destination');
    h.setTags([{ id: 'tag', name: '팀 태그', sortOrder: 0, color: '#ffffff' }]); const tag = nodes(h.render()).find(node => node.type === 'button' && text(node) === '팀 태그'); assert.ok(tag); tag.props.onClick(); h.render(); assert.equal(h.saved.length, 1); h.click('이 일정만'); await h.settle(); assert.deepEqual(h.saved[1].tagIds, ['tag']); assert.equal(h.calls[1].scope, 'this');
  } finally { h.dispose(); }
});
test('new native event includes repetition, location, safe meeting address and reminder', async () => {
  const h = await harness('EventCreateModal'); try {
    choose(h, '반복', 'weekdays'); h.type('장소', '회의실 A'); h.type('회의 주소', 'https://meet.example/room'); choose(h, '알림', '15'); h.click('만들기');
    assert.deepEqual(h.saved[0].recurrenceRule, { frequency: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] });
    assert.equal(h.saved[0].location, '회의실 A'); assert.equal(h.saved[0].meetingUrl, 'https://meet.example/room'); assert.equal(h.saved[0].reminderMinutes, 15);
  } finally { h.dispose(); }
});
for (const surface of ['EventQuickEdit', 'EventSidePanel'] as const) {
  test(`${surface}: recurring save asks scope; cancellation preserves dirty draft`, async () => {
    const h = await harness(surface, { recurrenceRule: { frequency: 'daily', interval: 1 }, recurrenceSeriesId: 'series', recurrenceDate: '2026-09-20' }); try {
      h.type('제목', '변경한 제목'); h.click('저장'); assert.equal(h.saved.length, 0); assert.ok(nodes(h.render()).some(node => node.props.role === 'dialog' && node.props['aria-label'] === '반복 일정 적용 범위'));
      h.click('범위 선택 취소'); assert.equal(h.input('제목').props.value, '변경한 제목'); h.click('저장'); h.click('이 일정만');
      assert.equal(h.saved[0].title, '변경한 제목'); assert.equal(h.calls[0].scope, 'this');
    } finally { h.dispose(); }
  });
  test(`${surface}: changing repetition only offers following/all and native URL invalidity blocks save`, async () => {
    const h = await harness(surface, { recurrenceRule: { frequency: 'daily', interval: 1 } }); try {
      h.type('회의 주소', 'javascript:alert(1)'); assert.equal(h.button('저장').props.disabled, true); h.type('회의 주소', 'https://meet.example'); choose(h, '반복', 'weekly'); h.click('저장');
      assert.equal(nodes(h.render()).some(node => node.type === 'button' && text(node) === '이 일정만'), false); h.click('이후 일정'); assert.equal(h.calls[0].scope, 'following'); assert.equal(h.saved[0].recurrenceRule.frequency, 'weekly');
    } finally { h.dispose(); }
  });
}
