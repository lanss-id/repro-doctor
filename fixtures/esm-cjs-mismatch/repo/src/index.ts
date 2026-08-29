import { formatAmount } from './format.js';

export function describeTotal(value: number): string {
  return `total ${formatAmount(value)}`;
}
