import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';

// Parent behavior harness: the shared picker owns keyboard/portal tests elsewhere.
// Keep its string-valued change contract while exposing a form control to existing callers.
export const glassDropdownTestModule = { GlassDropdown: 'glass-dropdown' };
export function resolveGlassDropdown(node: ReactNode): ReactNode {
  if (!isValidElement(node) || node.type !== 'glass-dropdown') return node;
  const props = node.props as {
    label?: string; value?: string | number; disabled?: boolean; portalOwner?: string;
    options: Array<{ value: string | number; label: string; disabled?: boolean }>;
    onChange: (value: string) => unknown;
  };
  return createElement('select', {
    'aria-label': props.label, value: props.value, disabled: props.disabled,
    'data-shared-dropdown': true, 'data-dropdown-owner': props.portalOwner,
    onChange: (event: { target: { value: string } }) => props.onChange(event.target.value),
  }, props.options.map(option => createElement('option', {
    key: option.value, value: option.value, disabled: option.disabled,
  }, option.label))) as ReactElement;
}
