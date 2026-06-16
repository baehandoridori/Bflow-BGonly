import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Google Calendar settings show auth retention and current connection state', () => {
  const sheetsSection = readFileSync('src/components/settings/SheetsSection.tsx', 'utf8');
  const overview = readFileSync('src/components/settings/IntegrationOverview.tsx', 'utf8');
  const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');

  assert.match(sheetsSection, /gcalAuthCheckedAt/);
  assert.match(sheetsSection, /인증 유지됨/);
  assert.match(sheetsSection, /앱을 다시 열어도 인증이 유지됩니다/);
  assert.match(sheetsSection, /현재 연동 상태/);
  assert.match(sheetsSection, /bflow:gcal-auth-changed/);
  assert.match(overview, /Google Calendar/);
  assert.match(overview, /인증 유지/);
  assert.match(sidebar, /calendarAuthState/);
  assert.match(sidebar, /gcalService\.isAuthenticated/);
  assert.match(sidebar, /캘린더 연동됨/);
  assert.match(sidebar, /캘린더 미연동/);
  assert.match(sidebar, /bflow:gcal-auth-changed/);
});
