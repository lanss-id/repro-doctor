import type { TokenUsage } from '../../src/domain/budget.js';
import type {
  CriticDriver,
  CriticReview,
  DriverOptions,
  DriverTurn,
  ModelDriver,
} from '../../src/agent/driver.js';
import type { AdvancedFinalOutput } from '../../src/agent/ledger.js';
import type { RepairSession } from '../../src/agent/session.js';

export interface ScriptedTurn {
  readonly text: string;
  readonly structured?: AdvancedFinalOutput;
  /** Reported as the provider's usage for this turn. Omit for no usage at all. */
  readonly usage?: TokenUsage;
}

export type Script = (session: RepairSession, turn: number) => Promise<ScriptedTurn>;

/**
 * Stands in for the model so integration tests can exercise the real sandbox,
 * the real patch pipeline and the real oracle without a network call. It uses
 * the same RepairSession the live agent uses, so budgets, path checks and
 * trajectory records all behave exactly as they do in production.
 *
 * Unless a turn declares usage, runs driven this way report none, which keeps
 * their cost honestly unknown rather than zero.
 */
export function scriptedDriver(script: Script): (
  options: DriverOptions,
  session: RepairSession,
) => ModelDriver {
  return (_options, session) => {
    let turnCount = 0;
    const execute = async (): Promise<DriverTurn> => {
      turnCount += 1;
      const scripted = await script(session, turnCount);
      return {
        text: scripted.text,
        structured: scripted.structured ?? null,
        history: [],
        usage: scripted.usage ?? null,
      };
    };
    return {
      start: execute,
      followUp: execute,
    };
  };
}

/** Records the feedback message the harness sends into the single retry. */
export function recordingDriver(script: Script, feedback: string[]): (
  options: DriverOptions,
  session: RepairSession,
) => ModelDriver {
  return (options, session) => {
    const inner = scriptedDriver(script)(options, session);
    return {
      start: (task) => inner.start(task),
      followUp: (previous, message) => {
        feedback.push(message);
        return inner.followUp(previous, message);
      },
    };
  };
}

/** A driver that never answers, so only the run deadline can end the run. */
export function blockingDriver(options: DriverOptions): ModelDriver {
  const wait = async (): Promise<DriverTurn> =>
    await new Promise<DriverTurn>((_resolve, reject) => {
      const signal = options.signal;
      if (signal === undefined) {
        return;
      }
      if (signal.aborted) {
        reject(new Error('the run deadline expired'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('the run deadline expired')), {
        once: true,
      });
    });
  return { start: wait, followUp: wait };
}

export interface ScriptedCritic {
  readonly approved: boolean;
  readonly critique: string;
  readonly usage?: TokenUsage;
}

export function scriptedCritic(review: ScriptedCritic): (options: DriverOptions) => CriticDriver {
  return () => ({
    review: async (): Promise<CriticReview> => ({
      approved: review.approved,
      critique: review.critique,
      parsed: true,
      usage: review.usage ?? null,
    }),
  });
}
