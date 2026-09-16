import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const tagRows = [
  { id: 'tag-a', name: '일반', color: '#FDCB6E', sortOrder: 0 },
  { id: 'tag-b', name: '업로드', color: '#E17055', sortOrder: 1 },
];

async function loadBadges() {
  const result = await build({ entryPoints: ['src/components/calendar/EventTagBadges.tsx'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react/jsx-runtime', '@/stores/useCalendarStore'] });
  const module = { exports: {} as Record<string, (props: Record<string, unknown>) => ReactNode> };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)((id: string) => id === '@/stores/useCalendarStore'
    ? { useCalendarStore: (select: (state: { tags: typeof tagRows }) => unknown) => select({ tags: tagRows }) }
    : require(id), module, module.exports);
  return module.exports.EventTagBadges;
}

test('event and tooltip badges render every selected tag in its own saved color', async () => {
  const Badges = await loadBadges();
  for (const props of [{}, { compact: true }, { tooltip: true }]) {
    const html = renderToStaticMarkup(createElement(Badges, { event: { tagIds: ['tag-b', 'tag-a'] }, ...props }));
    assert.match(html, /data-calendar-tag="tag-b"/);
    assert.match(html, /data-calendar-tag="tag-a"/);
    assert.ok(html.indexOf('업로드') < html.indexOf('일반'), 'badge order follows the user selection');
    assert.match(html, /#E17055/);
    assert.match(html, /#FDCB6E/);
  }
  assert.equal(renderToStaticMarkup(createElement(Badges, { event: { tagId: 'tag-a', tagIds: [] } })), '');
});

test('tag management entry appears only for admins and opens without submitting the event', async () => {
  let currentUser = { id: 'user', role: 'member' };
  let anchor: unknown = null;
  const result = await build({ entryPoints: ['src/components/calendar/EventTagManagerButton.tsx'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react/jsx-runtime', 'lucide-react', '@/stores/useAuthStore', './TagManagerPopover'] });
  const module = { exports: {} as Record<string, (props: { disabled?: boolean }) => ReactNode> };
  function Manager() { return null; }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)((id: string) => {
    if (id === 'react') return { ...require('react'), useState: () => [anchor, (value: unknown) => { anchor = value; }] };
    if (id === 'lucide-react') return { Settings2: () => null };
    if (id === '@/stores/useAuthStore') return { useAuthStore: (select: (state: { currentUser: typeof currentUser }) => unknown) => select({ currentUser }) };
    if (id === './TagManagerPopover') return { TagManagerPopover: Manager };
    return require(id);
  }, module, module.exports);
  const Button = module.exports.EventTagManagerButton;
  assert.equal(Button({}), null);
  currentUser = { id: 'admin', role: 'admin' };
  const tree = Button({});
  assert.ok(isValidElement(tree));
  const button = (tree.props as { children: Array<{ props: Record<string, unknown> }> }).children[0];
  assert.equal(button.props.type, 'button');
  assert.equal(button.props['aria-label'], '일정 태그 추가 및 삭제');
  let stopped = false;
  const rect = { top: 100, left: 100 };
  (button.props.onClick as (event: unknown) => void)({ stopPropagation() { stopped = true; }, currentTarget: { getBoundingClientRect: () => rect } });
  assert.equal(stopped, true);
  assert.equal(anchor, rect);
  const opened = Button({});
  assert.ok(isValidElement(opened));
  const popover = (opened.props as { children: Array<{ type: unknown }> }).children[1];
  assert.equal(popover.type, Manager);
  currentUser = { id: 'admin', role: 'member' };
  assert.equal(Button({}), null, 'revoking admin role removes the open management entry too');
});
