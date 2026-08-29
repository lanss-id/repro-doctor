import { applyDiscount } from '../../core/dist/index.js';

export function quote(cents: number): string {
  return `${applyDiscount(cents, 10)} cents`;
}
