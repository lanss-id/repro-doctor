import {
  Agent,
  MaxTurnsExceededError,
  ModelRefusalError,
  run,
  setDefaultOpenAIKey,
  setTracingDisabled,
  user,
  type AgentInputItem,
} from '@openai/agents';
import { z } from 'zod';
import type { TokenUsage } from '../domain/budget.js';
import type { ModelSettings } from '../domain/config.js';
import { ReproDoctorError } from '../domain/failure.js';
import type { Hypothesis } from '../domain/trajectory.js';
import { AdvancedFinalOutputSchema, type AdvancedFinalOutput } from './ledger.js';
import type { buildTools } from './tools.js';

export interface DriverTurn {
  readonly text: string;
  readonly structured: AdvancedFinalOutput | null;
  readonly history: AgentInputItem[];
  readonly usage: TokenUsage | null;
}

export interface ModelDriver {
  start(task: string): Promise<DriverTurn>;
  followUp(previous: DriverTurn, message: string): Promise<DriverTurn>;
}

export interface DriverOptions {
  readonly apiKey: string;
  readonly settings: ModelSettings;
  readonly instructions: string;
  readonly tools: ReturnType<typeof buildTools>;
  readonly structuredOutput: boolean;
  readonly signal?: AbortSignal;
}

/**
 * Thin wrapper over the OpenAI Agents SDK. Everything provider-specific lives
 * here: key handling, tracing, usage extraction and error mapping. The rest of
 * the codebase talks to {@link ModelDriver}.
 *
 * Tracing is switched off deliberately. Repository contents pass through this
 * agent, and uploading them to a trace backend is not something a repair tool
 * should do behind the operator's back.
 */
type TextAgent = Agent<unknown, 'text'>;
type LedgerAgent = Agent<unknown, typeof AdvancedFinalOutputSchema>;

export class AgentsSdkDriver implements ModelDriver {
  private readonly agent: TextAgent | LedgerAgent;
  private readonly options: DriverOptions;

  constructor(options: DriverOptions) {
    this.options = options;
    setDefaultOpenAIKey(options.apiKey);
    setTracingDisabled(true);
    const common = {
      name: 'repro-doctor-repair-agent',
      instructions: options.instructions,
      model: options.settings.model,
      modelSettings: {
        temperature: options.settings.temperature,
        topP: options.settings.topP,
        parallelToolCalls: options.settings.parallelToolCalls,
      },
      tools: options.tools,
    };
    if (options.structuredOutput) {
      const ledgerAgent: LedgerAgent = new Agent({ ...common, outputType: AdvancedFinalOutputSchema });
      this.agent = ledgerAgent;
    } else {
      const textAgent: TextAgent = new Agent({ ...common });
      this.agent = textAgent;
    }
  }

  async start(task: string): Promise<DriverTurn> {
    return await this.execute(task);
  }

  async followUp(previous: DriverTurn, message: string): Promise<DriverTurn> {
    return await this.execute([...previous.history, user(message)]);
  }

  private async execute(input: string | AgentInputItem[]): Promise<DriverTurn> {
    try {
      const result = await run(this.agent, input, {
        maxTurns: this.options.settings.maxTurns,
        ...(this.options.signal === undefined ? {} : { signal: this.options.signal }),
      });
      const finalOutput: unknown = result.finalOutput;
      const structured = this.options.structuredOutput
        ? AdvancedFinalOutputSchema.safeParse(finalOutput)
        : null;
      return {
        text:
          typeof finalOutput === 'string'
            ? finalOutput
            : JSON.stringify(finalOutput ?? null),
        structured: structured?.success === true ? structured.data : null,
        history: result.history,
        usage: extractUsage(result.rawResponses),
      };
    } catch (error) {
      throw mapDriverError(error);
    }
  }
}

interface RawResponseLike {
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly totalTokens?: number;
  };
}

/**
 * Token counts come from the provider or not at all. When the SDK reports
 * nothing, this returns null and the run records cost as unknown, rather than
 * inventing a plausible number.
 */
export function extractUsage(rawResponses: readonly RawResponseLike[]): TokenUsage | null {
  if (rawResponses.length === 0) {
    return null;
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let sawUsage = false;
  for (const response of rawResponses) {
    const usage = response.usage;
    if (usage === undefined) continue;
    sawUsage = true;
    inputTokens += usage.inputTokens ?? 0;
    outputTokens += usage.outputTokens ?? 0;
    totalTokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  }
  if (!sawUsage) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens, requests: rawResponses.length };
}

/** The shape this module needs from an SDK error that carried a run state. */
interface ErrorWithRunState {
  readonly state?: {
    readonly _modelResponses?: readonly RawResponseLike[];
  };
}

/**
 * Usage from a turn that ended by throwing. The SDK reports token counts on the
 * result object, so an error path returned nothing and a run that hit the turn
 * limit reported its cost as unknown while having made a dozen model calls. The
 * error carries the run state, and the state carries the same model responses
 * the success path reads, so the accounting is recoverable rather than lost.
 */
export function usageFromError(error: unknown): TokenUsage | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const responses = (error as ErrorWithRunState).state?._modelResponses;
  return Array.isArray(responses) ? extractUsage(responses) : null;
}

export function mapDriverError(error: unknown): ReproDoctorError {
  if (error instanceof ReproDoctorError) {
    return error;
  }
  if (error instanceof MaxTurnsExceededError) {
    return new ReproDoctorError('budget-exhausted', 'the agent hit the maximum number of turns', error.message);
  }
  if (error instanceof ModelRefusalError) {
    return new ReproDoctorError('model-refused', 'the model refused the task', error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ReproDoctorError('model-error', 'the model call failed', message);
}

export function hypothesesFrom(structured: AdvancedFinalOutput | null): Hypothesis[] {
  return structured === null ? [] : [...structured.hypotheses];
}

/**
 * The critic is an experimental treatment, not part of either published mode.
 * It reviews a proposed patch against the hypothesis ledger and the evidence,
 * and can send the patch back once. See docs/IMPROVEMENT_CHANGELOG.md for the
 * decision rule that governs whether it ever becomes default behaviour.
 */
export const CRITIC_INSTRUCTIONS = [
  'You review a proposed repair patch for a TypeScript repository. You cannot run anything.',
  'You are given the repository contract, the hypothesis ledger, the patch, and the evidence collected after it was applied.',
  '',
  'Approve only when the patch plausibly repairs the stated fault and the evidence supports it.',
  'Send it back when the patch changes something unrelated, weakens a test or a check instead of fixing the cause, or when the evidence does not actually show the fault is gone.',
  '',
  'Reply with one JSON object and nothing else:',
  '{"verdict": "approve" | "revise", "reason": "<one or two sentences>"}',
].join('\n');

export const CriticVerdictSchema = z.object({
  verdict: z.enum(['approve', 'revise']),
  reason: z.string(),
});

export interface CriticReview {
  readonly approved: boolean;
  readonly critique: string;
  /** False when the reply was not the JSON object the critic was asked for. */
  readonly parsed: boolean;
  readonly usage: TokenUsage | null;
}

export interface CriticDriver {
  review(message: string): Promise<CriticReview>;
}

export type CriticFactory = (options: DriverOptions) => CriticDriver;

/** Same model and settings as the repair agent, no tools, one turn. */
export function createCriticDriver(options: DriverOptions): CriticDriver {
  const agent: Agent<unknown, 'text'> = new Agent({
    name: 'repro-doctor-critic',
    instructions: CRITIC_INSTRUCTIONS,
    model: options.settings.model,
    modelSettings: {
      temperature: options.settings.temperature,
      topP: options.settings.topP,
      parallelToolCalls: options.settings.parallelToolCalls,
    },
    tools: [],
  });

  return {
    async review(message: string): Promise<CriticReview> {
      try {
        const result = await run(agent, message, {
          maxTurns: 1,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        const text = typeof result.finalOutput === 'string' ? result.finalOutput : '';
        const verdict = parseCriticVerdict(text);
        return {
          approved: verdict.parsed ? verdict.value.verdict === 'approve' : false,
          critique: verdict.parsed ? verdict.value.reason : text,
          parsed: verdict.parsed,
          usage: extractUsage(result.rawResponses),
        };
      } catch (error) {
        throw mapDriverError(error);
      }
    },
  };
}

type ParsedVerdict =
  | { parsed: true; value: z.infer<typeof CriticVerdictSchema> }
  | { parsed: false };

/**
 * An unparseable reply counts as "revise". Failing towards another attempt is
 * the safe direction: it costs budget, it never turns a bad patch into an
 * approved one.
 */
export function parseCriticVerdict(text: string): ParsedVerdict {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return { parsed: false };
  }
  try {
    const candidate: unknown = JSON.parse(text.slice(start, end + 1));
    const result = CriticVerdictSchema.safeParse(candidate);
    return result.success ? { parsed: true, value: result.data } : { parsed: false };
  } catch {
    return { parsed: false };
  }
}
