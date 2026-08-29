export interface CatalogEntry {
  readonly sku: string;
  readonly priceCents: number;
}

export function totalCents(entries: readonly CatalogEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.priceCents, 0);
}
