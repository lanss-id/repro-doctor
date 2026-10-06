import path from 'node:path';
import { DEFAULT_BUDGET, BudgetSchema, type Budget } from '../../domain/budget.js';
import { ReproDoctorError } from '../../domain/failure.js';
import { ModeSchema } from '../../domain/mode.js';
import { ExecutorKindSchema, type RunResult } from '../../domain/result.js';
import { describeVerification } from '../../domain/verification.js';
import { diagnose } from '../../agent/diagnose.js';
import { parseCheckCommand } from '../../agent/check-command.js';
import { findFixtureForRepo } from '../../fixtures/registry.js';
import { createLogger } from '../../infra/log.js';
import type { HiddenOracle } from '../../oracle/verify.js';
import { formatCost } from '../../report/run-report.js';
import {
  assertKnownFlags,
  numberFlag,
  requiredStringFlag,
  stringFlag,
  type ParsedArgs,
} from '../args.js';
import type { Presenter } from '../presenter.js';

const KNOWN_FLAGS = [
  'mode',
  'case-id',
  'oracle-dir',
  'oracle-entry',
  'oracle-timeout',
  'executor',
  'max-tool-calls',
  'max-patch-attempts',
  'max-seconds',
  'max-cost-usd',
  'command-timeout',
  'check-command',
  'task-file',
  'json',
];

export async function diagnoseCommand(args: ParsedArgs, presenter: Presenter): Promise<number> {
  assertKnownFlags(args, KNOWN_FLAGS);
  const repoArg = args.positionals[1];
  if (repoArg === undefined) {
    throw new ReproDoctorError('internal-error', 'diagnose needs a repository path');
  }
  const mode = ModeSchema.parse(requiredStringFlag(args, 'mode'));
  const executorFlag = stringFlag(args, 'executor');
  const executorKind = executorFlag === null ? undefined : ExecutorKindSchema.parse(executorFlag);
  const budget = budgetFromArgs(args);
  const repoPath = path.resolve(repoArg);

  const fixture = await findFixtureForRepo(repoPath);
  const oracleDir = stringFlag(args, 'oracle-dir');
  const oracle = resolveOracle(oracleDir, args, fixture);
  const caseId = stringFlag(args, 'case-id') ?? fixture?.meta.id ?? null;
  const checkFlag = stringFlag(args, 'check-command');
  const taskFile = stringFlag(args, 'task-file');
  const checkCommand = checkFlag === null ? null : parseCheckCommand(checkFlag);
  if (checkFlag !== null && checkCommand === null) {
    throw new ReproDoctorError('internal-error', '--check-command was empty');
  }

  presenter.heading('Diagnose');
  presenter.keyValue('repository', repoPath);
  presenter.keyValue('mode', mode);
  presenter.keyValue('case', caseId ?? '(not a registered fixture)');
  presenter.keyValue('hidden oracle', oracle === null ? 'none registered' : oracle.id);
  if (checkCommand !== null) {
    presenter.keyValue('check command', `${checkCommand.label} (given, not resolved from the manifest)`);
  }
  if (taskFile !== null) {
    presenter.keyValue('task file', taskFile);
  }
  presenter.keyValue(
    'budget',
    `${budget.maxToolCalls} tool calls, ${budget.maxPatchAttempts} patch attempts, ${budget.maxWallClockSeconds}s, $${budget.maxCostUsd}`,
  );

  // The first Ctrl-C asks the run to stop and still write its artifacts; the
  // second one is for when that is taking too long. Without this the process
  // died with the trajectory half written and no result.json at all, which is
  // how one AgentInspect follow-up run was lost after 38 tool calls.
  const stop = new AbortController();
  const onSigint = (): void => {
    if (stop.signal.aborted) {
      process.exit(130);
    }
    presenter.line('Interrupted. Stopping the run and writing its artifacts; press Ctrl-C again to exit now.');
    stop.abort();
  };
  process.on('SIGINT', onSigint);
  let result: RunResult;
  try {
    result = await diagnose({
      repoPath,
      mode,
      budget,
      caseId,
      oracle,
      logger: createLogger(),
      signal: stop.signal,
      ...(executorKind === undefined ? {} : { executorKind }),
      ...(checkCommand === null ? {} : { checkCommand }),
      ...(taskFile === null ? {} : { taskFile }),
    });
  } finally {
    process.off('SIGINT', onSigint);
  }

  presenter.heading('Result');
  presenter.keyValue('run id', result.runId);
  presenter.keyValue('outcome', result.outcome.status);
  presenter.keyValue('verification', describeVerification(result.verification));
  presenter.keyValue(
    'patch',
    result.patch.kind === 'empty'
      ? 'none'
      : `${result.patch.changedFiles.length} file(s), +${result.patch.addedLines}/-${result.patch.removedLines}`,
  );
  presenter.keyValue('tool calls', `${result.usage.toolCalls}/${budget.maxToolCalls}`);
  presenter.keyValue('patch attempts', `${result.usage.patchAttempts}/${budget.maxPatchAttempts}`);
  presenter.keyValue('wall clock', `${(result.usage.wallClockMs / 1000).toFixed(1)}s`);
  presenter.keyValue('cost', formatCost(result));
  presenter.keyValue('input repository', result.repo.mutated ? 'CHANGED (this is a bug)' : 'unchanged');

  presenter.heading('Artifacts');
  presenter.bullet(result.artifacts.resultPath);
  presenter.bullet(result.artifacts.trajectoryPath);
  presenter.bullet(result.artifacts.patchPath);
  presenter.bullet(result.artifacts.verificationLogPath);
  presenter.bullet(result.artifacts.reportPath);
  presenter.line();
  presenter.line(
    result.patch.kind === 'empty'
      ? 'No patch to apply.'
      : `Review and apply with: npm run doctor -- apply ${result.runId} --to ${result.repo.inputPath}`,
  );

  if (result.outcome.status === 'failed' && result.outcome.reason === 'interrupted') {
    return 130;
  }
  return result.outcome.status === 'failed' ? 1 : 0;
}

function budgetFromArgs(args: ParsedArgs): Budget {
  return BudgetSchema.parse({
    maxToolCalls: numberFlag(args, 'max-tool-calls') ?? DEFAULT_BUDGET.maxToolCalls,
    maxPatchAttempts: numberFlag(args, 'max-patch-attempts') ?? DEFAULT_BUDGET.maxPatchAttempts,
    maxWallClockSeconds: numberFlag(args, 'max-seconds') ?? DEFAULT_BUDGET.maxWallClockSeconds,
    maxCostUsd: numberFlag(args, 'max-cost-usd') ?? DEFAULT_BUDGET.maxCostUsd,
    commandTimeoutSeconds: numberFlag(args, 'command-timeout') ?? DEFAULT_BUDGET.commandTimeoutSeconds,
  });
}

function resolveOracle(
  oracleDir: string | null,
  args: ParsedArgs,
  fixture: Awaited<ReturnType<typeof findFixtureForRepo>>,
): HiddenOracle | null {
  if (oracleDir !== null) {
    return {
      id: path.basename(oracleDir),
      directory: path.resolve(oracleDir),
      entry: stringFlag(args, 'oracle-entry') ?? 'oracle.mjs',
      timeoutSeconds: numberFlag(args, 'oracle-timeout') ?? 120,
    };
  }
  if (fixture !== null) {
    return {
      id: `${fixture.meta.id}/oracle`,
      directory: fixture.oracleDir,
      entry: fixture.meta.oracle.entry,
      timeoutSeconds: fixture.meta.oracle.timeoutSeconds,
    };
  }
  return null;
}
