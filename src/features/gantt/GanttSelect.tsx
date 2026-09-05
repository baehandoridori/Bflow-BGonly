import { useState } from 'react';
import { GlassDropdown } from '@/components/common/GlassDropdown';
import './select.css';

export interface GanttSelectProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: Array<{value: string; label: string; disabled?: boolean}>;
  label: string;
  disabled?: boolean;
  name?: string;
}

/** The same dropdown as the rest of B flow, with native form submission support. */
export function GanttSelect({value, defaultValue, onChange, options, label, disabled, name}: GanttSelectProps) {
  const [selected, setSelected] = useState(defaultValue ?? options[0]?.value ?? '');
  const current = value ?? selected;
  return <div className="gantt-select">
    {name && <input type="hidden" name={name} value={current} disabled={disabled}/>}
    <GlassDropdown options={options} value={current} label={label} disabled={disabled} portal minWidth={150}
      onChange={next => {setSelected(next);onChange?.(next);}}/>
  </div>;
}
