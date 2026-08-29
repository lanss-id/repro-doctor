import { totalCents, type CatalogEntry } from '../lib/catalog.js';

export function describeCatalog(entries: readonly CatalogEntry[]): string {
  return `${entries.length} item(s), ${totalCents(entries)} cents`;
}
