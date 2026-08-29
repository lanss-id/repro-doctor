export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('mean of an empty list is undefined');
  }
  return sum(values) / values.length;
}
