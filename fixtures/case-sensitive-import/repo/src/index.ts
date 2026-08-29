import { formatDate } from './Utils/Format.js';

export function describeDate(value: Date): string {
  return `day ${formatDate(value)}`;
}
