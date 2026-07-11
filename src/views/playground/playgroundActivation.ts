import type { MouseEvent } from 'react';

import {
  originFromActivation,
  type Point,
} from '@/features/playground/transition/dotWipeMath';

export function pointFromButtonActivation(event: MouseEvent<HTMLButtonElement>): Point {
  return originFromActivation(
    event.clientX,
    event.clientY,
    event.detail,
    event.currentTarget.getBoundingClientRect(),
  );
}
