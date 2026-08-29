import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ExecutorKindSchema, type ExecutorKind } from './result.js';

export const DEFAULT_MODEL = 'gpt-4.1-mini';

/**
 * Model settings are part of the fairness contract: baseline and advanced runs
 * must share every value here. The fingerprint is written into both results so
 * a reviewer can confirm it without reading the code.
 */
export const ModelSettingsSchema = z.object({
  model: z.string().min(1),
  temperature: z.number(),
  topP: z.number(),
  maxTurns: z.number().int().positive(),
  parallelToolCalls: z.boolean(),
});
export type ModelSettings = z.infer<typeof ModelSettingsSchema>;

export function defaultModelSettings(model: string): ModelSettings {
  return { model, temperature: 0, topP: 1, maxTurns: 16, parallelToolCalls: false };
}

export function fingerprintModelSettings(settings: ModelSettings): string {
  const canonical = JSON.stringify({
    model: settings.model,
    temperature: settings.temperature,
    topP: settings.topP,
    maxTurns: settings.maxTurns,
    parallelToolCalls: settings.parallelToolCalls,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export interface RuntimeConfig {
  readonly model: string;
  readonly apiKey: string | null;
  readonly defaultExecutor: ExecutorKind;
  readonly runnerImage: string;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const rawExecutor = env['REPRO_DOCTOR_EXECUTOR'];
  const parsedExecutor = ExecutorKindSchema.safeParse(rawExecutor ?? 'docker');
  const apiKey = env['OPENAI_API_KEY'];
  return {
    model: env['REPRO_DOCTOR_MODEL']?.trim() || DEFAULT_MODEL,
    apiKey: apiKey !== undefined && apiKey.trim().length > 0 ? apiKey : null,
    defaultExecutor: parsedExecutor.success ? parsedExecutor.data : 'docker',
    runnerImage: env['REPRO_DOCTOR_RUNNER_IMAGE']?.trim() || 'repro-doctor-runner:1',
  };
}
