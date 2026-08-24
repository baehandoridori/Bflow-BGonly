import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canViewCalendar,
  canEditCalendarEvents,
  canManageCalendar,
  canCreateCalendar,
} from '../src/shared/calendarPermissions.ts';

const OWNER = 'u-owner';
const EDITOR = 'u-editor';
const VIEWER = 'u-viewer';
const OUTSIDER = 'u-outsider';
const ADMIN = { id: 'u-admin', role: 'admin' as const };
const NORMAL = (id: string) => ({ id, role: 'user' as const });
const MEMBERS = [{ user_id: EDITOR, can_edit: true }, { user_id: VIEWER, can_edit: false }];
const MEMBER_IDS = MEMBERS.map((member) => member.user_id);
const cal = (visibility: 'private' | 'members' | 'team', isPersonal = false) =>
  ({ owner_id: OWNER, visibility, is_personal: isPersonal });

test('canViewCalendar: 역할 매트릭스', () => {
  for (const visibility of ['private', 'members'] as const) {
    for (const userId of [OWNER, EDITOR, VIEWER]) assert.equal(canViewCalendar(cal(visibility), MEMBER_IDS, userId), true);
    for (const userId of [OUTSIDER, ADMIN.id]) assert.equal(canViewCalendar(cal(visibility), MEMBER_IDS, userId), false);
  }
  for (const userId of [OUTSIDER, ADMIN.id]) assert.equal(canViewCalendar(cal('team'), [], userId), true);
});

test('canEditCalendarEvents: 소유자 + can_edit 멤버만', () => {
  for (const visibility of ['private', 'members', 'team'] as const) {
    for (const userId of [OWNER, EDITOR]) assert.equal(canEditCalendarEvents(cal(visibility), MEMBERS, userId), true);
    for (const userId of [VIEWER, OUTSIDER, ADMIN.id]) assert.equal(canEditCalendarEvents(cal(visibility), MEMBERS, userId), false);
  }
});

test('canManageCalendar: 소유자 또는 admin, 단 개인 캘린더는 소유자만', () => {
  assert.equal(canManageCalendar(cal('members'), NORMAL(OWNER)), true);
  assert.equal(canManageCalendar(cal('members'), ADMIN), true);
  for (const userId of [EDITOR, OUTSIDER]) assert.equal(canManageCalendar(cal('members'), NORMAL(userId)), false);
  assert.equal(canManageCalendar(cal('private', true), NORMAL(OWNER)), true);
  assert.equal(canManageCalendar(cal('private', true), ADMIN), false);
});

test('canCreateCalendar: team 은 admin 만', () => {
  assert.equal(canCreateCalendar(ADMIN, 'team'), true);
  assert.equal(canCreateCalendar(NORMAL(OUTSIDER), 'team'), false);
  for (const visibility of ['private', 'members'] as const) {
    assert.equal(canCreateCalendar(NORMAL(OUTSIDER), visibility), true);
    assert.equal(canCreateCalendar(ADMIN, visibility), true);
  }
});
