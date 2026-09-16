import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseCalendarAdminOverview, CALENDAR_OVERVIEW_ADMIN_ID, canEditCalendarEvents } from '../src/shared/calendarPermissions.ts';
import { normalizeCalendarTagIds } from '../src/shared/calendarTagIds.ts';
test('overview requires canonical administrator identity and never grants editing', () => {
 assert.equal(canUseCalendarAdminOverview({id:CALENDAR_OVERVIEW_ADMIN_ID,role:'admin'}),true);
 assert.equal(canUseCalendarAdminOverview({id:CALENDAR_OVERVIEW_ADMIN_ID,role:'user'}),false);
 assert.equal(canUseCalendarAdminOverview({id:'another-admin',role:'admin'}),false);
 assert.equal(canEditCalendarEvents({owner_id:'other',visibility:'private',is_personal:true},[],CALENDAR_OVERVIEW_ADMIN_ID),false);
});
test('multi tags preserve order, dedupe, explicit clearing, and legacy fallback', () => {
 assert.deepEqual(normalizeCalendarTagIds(['b','a','b'],'c'),['b','a']);
 assert.deepEqual(normalizeCalendarTagIds([], 'a'),[]);
 assert.deepEqual(normalizeCalendarTagIds(undefined,'a'),['a']);
 assert.deepEqual(normalizeCalendarTagIds(undefined,null),[]);
 assert.throws(()=>normalizeCalendarTagIds('bad' as unknown as string[],null));
 assert.throws(()=>normalizeCalendarTagIds([null] as unknown as string[],null));
});
