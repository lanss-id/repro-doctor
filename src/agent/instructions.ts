import type { Budget } from '../domain/budget.js';
import type { Mode } from '../domain/mode.js';
import type { TaskContext } from './task-context.js';

/**
 * Wording is the whole experiment. Both modes see the same repository, the same
 * tools and the same budget; only the text below and the harness structure
 * around it differ.
 */

export function baselineInstructions(budget: Budget): string {
  return [
    'You are a repair agent working on an unfamiliar TypeScript repository.',
    'The repository is broken. Investigate it and fix it.',
    '',
    'Tools available: list_files, read_file, run_command, propose_patch.',
    'read_file returns a window of lines and says how many lines lie below it. Move the window with start_line rather than reading the same file again.',
    'propose_patch either writes a file whole or replaces one exact block of text inside it. A file too large to write whole must be changed by replacing a block.',
    'The repository is a disposable copy inside a sandbox with no network access.',
    `You have at most ${budget.maxToolCalls} tool calls and ${budget.maxPatchAttempts} patch attempts.`,
    'Every tool result ends with a [budget] line showing the calls you have left. Plan backwards from it: a fix you cannot still submit as a patch is worth nothing.',
    'When you are done, reply with a short description of what you changed.',
  ].join('\n');
}

/**
 * `retryEnabled` is false only in the ablation's treatment arm, where the
 * harness will not offer a second turn. Step 8 has to say so: telling the model
 * about a retry it will never get would measure a broken promise rather than a
 * missing mechanism.
 */
export function advancedInstructions(budget: Budget, retryEnabled = true): string {
  return [
    'You are a repair agent working on an unfamiliar TypeScript repository.',
    'The repository is broken. Find the smallest change that makes it work.',
    '',
    'Tools available: list_files, read_file, run_command, propose_patch.',
    'read_file returns a window of lines and says how many lines lie below it. Move the window with start_line rather than reading the same file again.',
    'propose_patch either writes a file whole or replaces one exact block of text inside it. A file too large to write whole must be changed by replacing a block.',
    'The repository is a disposable copy inside a sandbox with no network access.',
    `You have at most ${budget.maxToolCalls} tool calls and ${budget.maxPatchAttempts} patch attempts.`,
    'Every tool result ends with a [budget] line showing the calls you have left. Plan backwards from it: a fix you cannot still submit as a patch is worth nothing.',
    '',
    'Method, in order:',
    '1. A preflight report is included in your task message. Read it first and do not re-run the commands it already ran. It was charged to the same budget, and it states how much of that budget is left.',
    '2. A check that exits zero is not evidence that the repository works. When the preflight check passes, the fault is a promise the code does not keep: read the README, the manifest and the configuration for what this project says it does, then test that promise directly with run_command instead of trusting the exit code.',
    '3. Keep a hypothesis ledger. Each hypothesis names one concrete fault, cites the evidence line that supports it, and is marked proposed, supported, refuted, or fixed.',
    '4. Prefer one command that discriminates between hypotheses over several that confirm the one you already believe.',
    '5. Patch minimally. Change configuration or source only where a supported hypothesis says the fault is. Do not reformat, rename, upgrade dependencies, add libraries, add tests, or "improve" untouched code.',
    '6. Never edit or weaken a test, an assertion, or a check in order to make it pass. Fix the cause.',
    '7. Put every file supported by the current evidence into one minimal propose_patch call. After that call succeeds, stop calling tools and return the structured ledger. The harness, not you, owns post-patch verification.',
    retryEnabled
      ? '8. The harness re-runs the project check itself, and an independent verification you cannot see runs against a fresh copy of your repaired tree. If either is not satisfied you get exactly one more repair turn, with their output. There is no third attempt. The [budget] line counts only what this turn may spend; the retry is paid for separately.'
      : '8. The harness re-runs the project check itself, and an independent verification you cannot see runs against a fresh copy of your repaired tree. You do not get a second repair turn. The patch you submit is the one that is scored, so submit it while you still have the budget to.',
    '',
    'Your final answer must be the structured ledger plus a one-line summary of the patch.',
  ].join('\n');
}

export function instructionsFor(mode: Mode, budget: Budget, retryEnabled = true): string {
  return mode === 'baseline'
    ? baselineInstructions(budget)
    : advancedInstructions(budget, retryEnabled);
}

/**
 * The task statement. Identical for both modes so the comparison is about
 * method, not about how much of the answer the prompt gave away.
 */
export function taskMessage(repositoryName: string, taskContext?: TaskContext): string {
  const parts = [
    `Repository under repair: ${repositoryName}`,
    '',
    'The project does not work. Diagnose the fault and repair it so the project behaves as its own README, package manifest and configuration say it should.',
    'Do not change the project\'s intended behaviour or its public contract. Repair it so the stated contract holds.',
  ];
  if (taskContext !== undefined) {
    parts.push(
      '',
      `The operator supplied a problem statement from ${taskContext.relativePath}:`,
      '--- task statement ---',
      taskContext.content,
      '--- end task statement ---',
      'Treat that file as the problem statement. Do not edit it.',
    );
  }
  return parts.join('\n');
}

export interface FeedbackInput {
  readonly checkPassed: boolean;
  readonly checkLabel: string;
  readonly checkExitCode: number | null;
  readonly checkOutput: string;
  readonly patchProduced: boolean;
  /** Sanitized `PASS`/`FAIL` lines from the independent verification, if it ran. */
  readonly oracleFindings: readonly string[] | null;
  readonly critique: string | null;
  /** Calls the retry turn may actually spend, reservation included. */
  readonly remainingToolCalls: number;
}

/**
 * The one feedback message the advanced mode may send. It carries the harness's
 * own re-run of the repository check and, when the independent verification
 * ran, its pass and fail lines. The verification code itself is never mounted
 * in the repair sandbox and never quoted here: only the sanitized result of
 * running it crosses back.
 */
export function evidenceFeedback(input: FeedbackInput): string {
  const parts: string[] = [
    `Independent evidence gate: ${input.checkPassed ? 'PASSED' : 'FAILED'}.`,
    `The harness re-ran ${input.checkLabel} itself after your first turn; exit code ${input.checkExitCode ?? 'unknown'}.`,
    ...(input.patchProduced
      ? []
      : ['No patch was produced in the first turn. A diagnosis alone does not repair the repository.']),
    '',
    input.checkOutput,
  ];

  if (input.oracleFindings !== null) {
    parts.push(
      '',
      'Independent verification also ran outside your sandbox, against a fresh copy of the repaired tree.',
      'It checks behaviour, not the exit code of the project check. It reported:',
      ...input.oracleFindings.map((finding) => `  ${finding}`),
    );
  }

  if (input.critique !== null) {
    parts.push('', 'A reviewer looked at your patch and asked for a revision:', `  ${input.critique}`);
  }

  parts.push(
    '',
    'Revise your hypothesis ledger against this evidence and make one more minimal patch attempt.',
    'This is the last attempt you get.',
    // The retry runs on a reservation, not on whatever the first turn left
    // behind. An agent that does not know the size of that reservation spends
    // it on one more look at a file it has already read.
    `You have ${input.remainingToolCalls} tool call${input.remainingToolCalls === 1 ? '' : 's'} left in the whole run. Spend ${input.remainingToolCalls === 1 ? 'it' : 'them'} on propose_patch, not on reading files again; the evidence above is everything you get.`,
  );
  return parts.join('\n');
}
