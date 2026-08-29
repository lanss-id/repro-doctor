import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Cost, TokenUsage } from '../domain/budget.js';
import { projectRoot } from '../infra/project-root.js';

export const ModelPriceSchema = z.object({
  inputUsdPerMillionTokens: z.number().nonnegative(),
  outputUsdPerMillionTokens: z.number().nonnegative(),
  source: z.string().min(1),
  /** Where the number came from, so a stale price can be traced and rechecked. */
  sourceUrl: z.string().url().optional(),
  /** ISO date on which a human read that page and confirmed the number. */
  verifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

export const PriceTableSchema = z.object({
  note: z.string(),
  models: z.record(z.string(), ModelPriceSchema),
});
export type PriceTable = z.infer<typeof PriceTableSchema>;

export const EMPTY_PRICE_TABLE: PriceTable = {
  note: 'no prices configured',
  models: {},
};

/**
 * Loads config/pricing.json and applies the environment override, if any.
 *
 * A model with no entry is not given a default. It reports its cost as unknown,
 * and `runEvaluation` refuses to start a live scored batch for it, because a
 * guessed price in a benchmark table is worse than a missing one.
 */
export function loadPriceTable(
  env: NodeJS.ProcessEnv = process.env,
  filePath: string = path.join(projectRoot(), 'config', 'pricing.json'),
): PriceTable {
  let table: PriceTable = EMPTY_PRICE_TABLE;
  try {
    const parsed = PriceTableSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf8')));
    if (parsed.success) {
      table = parsed.data;
    }
  } catch {
    // Missing or unreadable price file means "unknown", never a default guess.
  }
  const model = env['REPRO_DOCTOR_MODEL'];
  const input = env['REPRO_DOCTOR_PRICE_INPUT_PER_MTOK'];
  const output = env['REPRO_DOCTOR_PRICE_OUTPUT_PER_MTOK'];
  if (model !== undefined && input !== undefined && output !== undefined && input !== '' && output !== '') {
    const inputPrice = Number(input);
    const outputPrice = Number(output);
    if (Number.isFinite(inputPrice) && Number.isFinite(outputPrice)) {
      return {
        note: table.note,
        models: {
          ...table.models,
          [model]: {
            inputUsdPerMillionTokens: inputPrice,
            outputUsdPerMillionTokens: outputPrice,
            source: 'environment override',
          },
        },
      };
    }
  }
  return table;
}

export function priceFor(table: PriceTable, model: string): ModelPrice | null {
  return table.models[model] ?? null;
}

export function hasPrice(table: PriceTable, model: string): boolean {
  return priceFor(table, model) !== null;
}

export function describePrice(table: PriceTable, model: string): string {
  const price = priceFor(table, model);
  if (price === null) {
    return `no price configured for ${model}`;
  }
  const verified = price.verifiedOn === undefined ? '' : `, verified ${price.verifiedOn}`;
  return `${model}: $${price.inputUsdPerMillionTokens}/1M in, $${price.outputUsdPerMillionTokens}/1M out (${price.source}${verified})`;
}

export function computeCost(
  table: PriceTable,
  model: string,
  usage: TokenUsage | null,
): Cost {
  if (usage === null) {
    return { kind: 'unknown', why: 'no-usage-reported' };
  }
  if (usage.requests === 0) {
    return { kind: 'unknown', why: 'no-model-call' };
  }
  const price = priceFor(table, model);
  if (price === null) {
    return { kind: 'unknown', why: 'no-price-configured' };
  }
  const usd =
    (usage.inputTokens / 1_000_000) * price.inputUsdPerMillionTokens +
    (usage.outputTokens / 1_000_000) * price.outputUsdPerMillionTokens;
  return { kind: 'measured', usd: Number(usd.toFixed(6)) };
}
