import path from 'node:path';
import { stat } from 'node:fs/promises';
import { DEFAULT_BUDGET, type Budget, type Cost } from '../domain/budget.js';
import {
  defaultModelSettings,
  fingerprintModelSettings,
  loadRuntimeConfig,
} from '../domain/config.js';
import { ReproDoctorError, describeError, toFailureReason } from '../domain/failure.js';
import { newRunId, type RunId } from '../domain/ids.js';
import type { Mode } from '../domain/mode.js';
import type { PatchSummary } from '../domain/patch.js';
import {
  RESULT_SCHEMA_VERSION,
  type ExecutorKind,
  type RunOutcome,
  type RunResult,
} from '../domain/result.js';
import type { Hypothesis, VerificationStage } from '../domain/trajectory.js';
import type { VerificationOutcome } from '../domain/verification.js';
import {
  TrajectoryWriter,
  prepareRunDirectory,
  writePatch,
  writeRunResult,
  writeVerificationLog,
} from '../infra/artifacts.js';
import { createUnifiedDiff, countPatchLines, parseUnifiedDiff } from '../infra/diff/unified.js';
import { sha256, treeChecksum } from '../infra/fs/checksum.js';
import { copyRepositoryToWorkspace } from '../infra/fs/copy.js';
import { isInside } from '../infra/fs/paths.js';
import { readFileMap } from '../infra/fs/snapshot.js';
import { createExecutor } from '../infra/exec/factory.js';
import { outcomeExitCode, type SandboxExecutor } from '../infra/exec/types.js';
import { createLogger, type Logger } from '../infra/log.js';
import { redactText } from '../infra/redact.js';
import { artifactsRoot } from '../infra/project-root.js';
import { runHiddenOracle, type HiddenOracle } from '../oracle/verify.js';
import { renderRunReport } from '../report/run-report.js';
import { BudgetExceededError, BudgetTracker } from './budget-tracker.js';
import { checkCommandFor, readManifest, type CheckCommand } from './check-command.js';
import {
  AgentsSdkDriver,
  createCriticDriver,
  hypothesesFrom,
  usageFromError,
  type CriticFactory,
  type DriverOptions,
  type DriverTurn,
  type ModelDriver,
} from './driver.js';
import { evidenceFeedback, instructionsFor, taskMessage } from './instructions.js';
import { renderLedger } from './ledger.js';
import { computeCost, hasPrice, loadPriceTable, type PriceTable } from './pricing.js';
import { runPreflight } from './preflight.js';
import { clamp, renderExecOutcome, RepairSession } from './session.js';
import { loadTaskContext } from './task-context.js';
import { buildTools } from './tools.js';

/** Tool calls advanced mode keeps for the evidence-driven repair turn. */
export const RETRY_TOOL_CALL_RESERVE = 1;

/** The critic arm's own review call, held back from the agent for the same reason. */
export const CRITIC_TOOL_CALL_RESERVE = 1;

export interface DiagnoseOptions {
  readonly repoPath: string;
  readonly mode: Mode;
  readonly budget?: Budget;
  readonly executorKind?: ExecutorKind;
  readonly caseId?: string | null;
  readonly oracle?: HiddenOracle | null;
  readonly runId?: RunId;
  readonly logger?: Logger;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowLocalAdapter?: boolean;
  readonly priceTable?: PriceTable;
  /**
   * Experimental treatment, off by default and not part of either published
   * mode. Advanced mode only. See docs/IMPROVEMENT_CHANGELOG.md.
   */
  readonly criticEnabled?: boolean;
  readonly criticFactory?: CriticFactory;
  /**
   * Ablation treatment, advanced mode only. Default true, which is published
   * advanced mode. False removes the whole retry design at once: the retry
   * turn, the tool calls reserved for it, and the promise of a second turn in
   * the instructions. See docs/PREREGISTRATION.md for why those three move
   * together rather than one at a time.
   */
  readonly retryEnabled?: boolean;
  /**
   * Ablation treatment, advanced mode only. Default true. Setting it false
   * without also disabling the retry is refused: the retry has to be paid for.
   *
   * It exists so an ablation can hold the reservation still while removing the
   * retry turn. E6 removed both together and could not say which of them the
   * result belonged to. See docs/PREREGISTRATION.md, E6b.
   */
  readonly reserveEnabled?: boolean;
  /**
   * The command that says whether the repository works, when the one resolved
   * from the manifest is the wrong question. A repository's own `check` script
   * often runs lint and formatting too, which report on its devDependencies
   * rather than on its behaviour. Both modes and the evidence gate use whatever
   * this resolves to, so it can never advantage one arm over the other.
   */
  readonly checkCommand?: CheckCommand | null;
  /** Optional problem statement copied from a relative file inside the target repository. */
  readonly taskFile?: string;
  /**
   * Test seam. Integration tests drive the real sandbox, patcher and oracle
   * with a scripted driver instead of a live model. Results produced this way
   * name the scripted model in result.json and are excluded from scoring.
   */
  readonly driverFactory?: (options: DriverOptions, session: RepairSession) => ModelDriver;
  readonly modelOverride?: string;
}

interface VerificationRun {
  readonly outcome: VerificationOutcome;
  readonly log: string;
}

export async function diagnose(options: DiagnoseOptions): Promise<RunResult> {
  const env = options.env ?? process.env;
  const config = loadRuntimeConfig(env);
  const logger = options.logger ?? createLogger();
  const budget = options.budget ?? DEFAULT_BUDGET;
  const executorKind = options.executorKind ?? config.defaultExecutor;
  const model = options.modelOverride ?? config.model;
  const settings = defaultModelSettings(model, budget.maxToolCalls);
  const priceTable = options.priceTable ?? loadPriceTable(env);
  const startedAt = new Date();

  const repoPath = path.resolve(options.repoPath);
  const repoStats = await stat(repoPath).catch(() => null);
  if (repoStats === null || !repoStats.isDirectory()) {
    throw new ReproDoctorError('unsafe-path', `repository not found: ${repoPath}`);
  }
  if (isInside(artifactsRoot(), repoPath)) {
    throw new ReproDoctorError(
      'unsafe-path',
      'refusing to diagnose a path inside artifacts/; point at the original repository instead',
    );
  }
  const live = options.driverFactory === undefined;
  if (live && config.apiKey === null) {
    throw new ReproDoctorError(
      'missing-api-key',
      'OPENAI_API_KEY is not set',
      'diagnose calls a live model. Set OPENAI_API_KEY, or see docs/EVALUATION.md for what can run without one.',
    );
  }
  if (live && !hasPrice(priceTable, model)) {
    throw new ReproDoctorError(
      'no-price-configured',
      `no token price is configured for ${model}`,
      'The USD 0.30 run budget cannot be enforced without a verified price. Add the model to config/pricing.json or set both REPRO_DOCTOR_PRICE_INPUT_PER_MTOK and REPRO_DOCTOR_PRICE_OUTPUT_PER_MTOK.',
    );
  }

  const runId = options.runId ?? newRunId(startedAt);
  const paths = await prepareRunDirectory(runId);
  const trajectory = new TrajectoryWriter(paths.trajectoryPath);
  const runLogger = logger.child({ runId, mode: options.mode });

  const checksumBefore = await treeChecksum(repoPath);
  await trajectory.append({
    type: 'run.started',
    mode: options.mode,
    caseId: options.caseId ?? null,
    model,
    executor: executorKind,
    budget,
  });

  const copyReport = await copyRepositoryToWorkspace(repoPath, paths.workspaceDir);
  const taskContext =
    options.taskFile === undefined
      ? undefined
      : await loadTaskContext(paths.workspaceDir, options.taskFile);
  const pristine = await readFileMap(paths.workspaceDir);
  await trajectory.append({
    type: 'workspace.prepared',
    fileCount: copyReport.fileCount,
    treeChecksum: await treeChecksum(paths.workspaceDir),
  });
  runLogger.info('workspace.prepared', {
    files: copyReport.fileCount,
    workspace: paths.workspaceDir,
  });

  const tracker = new BudgetTracker(budget, startedAt.getTime());
  let outcome: RunOutcome = { status: 'no-patch', detail: 'the run did not reach the agent phase' };
  let hypotheses: Hypothesis[] = [];
  let cost: Cost = { kind: 'unknown', why: 'no-model-call' };

  const executor = await createExecutor({
    kind: executorKind,
    workspacePath: paths.workspaceDir,
    commandTimeoutSeconds: budget.commandTimeoutSeconds,
    purpose: 'repair',
    image: config.runnerImage,
    ...(options.allowLocalAdapter === undefined ? {} : { allowLocalAdapter: options.allowLocalAdapter }),
  });

  const session = new RepairSession({ executor, budget: tracker, trajectory, logger: runLogger });
  const tools = buildTools(session);

  // One deadline for the whole run: model calls, tools, the retry and
  // verification all live inside it. Tool timeouts stay bounded separately.
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => {
    tracker.markLimit('wall-clock');
    deadline.abort(new Error(`run deadline of ${budget.maxWallClockSeconds}s expired`));
  }, budget.maxWallClockSeconds * 1000);
  // Deliberately referenced. A model call that hangs without holding an open
  // handle leaves this timer as the only pending work, and an unreferenced
  // timer lets Node 22 exit before the deadline can abort the run: the process
  // dies quietly instead of producing a budget-exhausted result with its
  // artifacts. The finally block below always clears it, so a finished run is
  // never held open by it.

  // The critic acts on the run through the retry, so the two are never
  // switched off together. No experiment asks for that combination and the
  // registry in experiments.ts cannot express it.
  const retryEnabled = options.retryEnabled !== false;
  // The reservation exists to fund the retry, so a run cannot keep the retry
  // and drop the calls it needs. The other direction is allowed and is what
  // the E6b ablation arm is.
  const reserveEnabled = retryEnabled || options.reserveEnabled !== false;

  const driverOptions: DriverOptions = {
    apiKey: config.apiKey ?? 'scripted-driver-no-key',
    settings,
    instructions: instructionsFor(options.mode, budget, retryEnabled),
    tools,
    structuredOutput: options.mode === 'advanced',
    signal: deadline.signal,
  };
  const driver =
    options.driverFactory === undefined
      ? new AgentsSdkDriver(driverOptions)
      : options.driverFactory(driverOptions, session);

  const useCritic = options.criticEnabled === true && options.mode === 'advanced';
  const critic = useCritic
    ? (options.criticFactory ?? createCriticDriver)(driverOptions)
    : null;

  /** Runs the hidden oracle on the current workspace. Never mounted for repair. */
  const verifyIndependently = async (stage: VerificationStage): Promise<VerificationRun | null> => {
    const oracle = options.oracle;
    if (oracle == null) {
      return null;
    }
    const remainingSeconds = Math.floor(tracker.remainingWallClockMs / 1000);
    if (remainingSeconds <= 0) {
      return {
        outcome: { kind: 'skipped', why: 'run-aborted' },
        log: 'the run deadline expired before verification could start\n',
      };
    }
    await trajectory.append({ type: 'verification.started', oracleId: oracle.id, stage });
    const bounded: HiddenOracle = {
      ...oracle,
      timeoutSeconds: Math.min(oracle.timeoutSeconds, remainingSeconds),
    };
    let run: VerificationRun;
    try {
      run = await runHiddenOracle({
        oracle: bounded,
        repairedWorkspace: paths.workspaceDir,
        scratchDirectory: path.join(paths.runDir, `verify-${stage}`),
        executorKind,
        ...(options.allowLocalAdapter === undefined
          ? {}
          : { allowLocalAdapter: options.allowLocalAdapter }),
      });
    } catch (error) {
      const failed: VerificationOutcome = { kind: 'oracle-error', message: describeError(error) };
      run = { outcome: failed, log: `oracle failed to run: ${describeError(error)}\n` };
    }
    await trajectory.append({ type: 'verification.completed', outcome: run.outcome, stage });
    return run;
  };

  let interim: VerificationRun | null = null;
  let retried = false;

  try {
    let task = taskMessage(path.basename(repoPath), taskContext);
    if (options.mode === 'advanced') {
      const preflight = await runPreflight(session, trajectory, {
        checkCommand: options.checkCommand ?? null,
      });
      task = `${task}\n\n${preflight.text}`;
      // Advanced mode promises one evidence-driven repair turn. Hold back the
      // calls that turn needs before the agent starts spending, or a first
      // patch on the last call cancels the promise without anyone noticing.
      tracker.setToolCallReserve(
        (reserveEnabled ? RETRY_TOOL_CALL_RESERVE : 0) +
          (critic === null ? 0 : CRITIC_TOOL_CALL_RESERVE),
      );
      session.beginCheckpointedRepairTurn();
    }

    let turn: DriverTurn = await driver.start(task);
    await recordAssistantTurn(trajectory, turn);
    cost = accountFor(tracker, turn, priceTable, model);
    hypotheses = hypothesesFrom(turn.structured);

    if (options.mode === 'advanced') {
      const gate = await runEvidenceGate(
        executor,
        tracker,
        trajectory,
        paths.workspaceDir,
        1,
        options.checkCommand ?? null,
      );

      // The independent oracle runs here, after the agent's first attempt, on a
      // fresh copy. Its result drives the single retry; its code is never
      // visible to the agent.
      const patchedSoFar = createUnifiedDiff(pristine, await readFileMap(paths.workspaceDir));
      const patchProduced = patchedSoFar.trim().length > 0;
      interim = patchProduced ? await verifyIndependently('interim') : null;
      const oracleSatisfied = interim === null || interim.outcome.kind === 'passed';

      let critique: string | null = null;
      if (critic !== null) {
        tracker.setToolCallReserve(RETRY_TOOL_CALL_RESERVE);
        tracker.chargeToolCall();
        const review = await critic.review(
          criticMessage(patchedSoFar, hypotheses, gate.detail),
        );
        if (review.usage !== null) {
          tracker.addTokens(review.usage);
          cost = computeCost(priceTable, model, tracker.tokenUsage);
          tracker.assertCost(cost);
        }
        await trajectory.append({
          type: 'critic.reviewed',
          approved: review.approved,
          critique: review.critique.slice(0, 1000),
          parsed: review.parsed,
        });
        critique = review.approved ? null : review.critique;
      }

      // The retry's own budget comes back here, and nowhere earlier.
      tracker.clearToolCallReserve();
      const needsRetry =
        retryEnabled && (!patchProduced || !gate.passed || !oracleSatisfied || critique !== null);
      if (needsRetry && tracker.remainingPatchAttempts > 0 && tracker.remainingToolCalls > 0) {
        const feedback = evidenceFeedback({
          checkPassed: gate.passed,
          checkLabel: gate.label,
          checkExitCode: gate.exitCode,
          checkOutput: gate.detail,
          patchProduced,
          oracleFindings:
            interim === null ? null : sanitizeFindings(interim.outcome, paths.runDir, options.oracle),
          critique,
          remainingToolCalls: tracker.remainingToolCalls,
        });
        await trajectory.append({ type: 'model.message', role: 'user', text: feedback });
        session.beginCheckpointedRepairTurn();
        turn = await driver.followUp(turn, feedback);
        retried = true;
        await recordAssistantTurn(trajectory, turn);
        cost = accountFor(tracker, turn, priceTable, model);
        hypotheses = hypothesesFrom(turn.structured);
        await runEvidenceGate(
          executor,
          tracker,
          trajectory,
          paths.workspaceDir,
          2,
          options.checkCommand ?? null,
        );
      }
    }

    if (hypotheses.length > 0) {
      await trajectory.append({ type: 'hypothesis.updated', ledger: hypotheses });
    }
    outcome = { status: 'no-patch', detail: 'the agent finished without changing any file' };
  } catch (error) {
    const failure =
      deadline.signal.aborted && !(error instanceof BudgetExceededError)
        ? new BudgetExceededError(
            'wall-clock',
            `the run deadline of ${budget.maxWallClockSeconds}s expired`,
          )
        : error;
    // A turn that ended by throwing was still billed for every model call it
    // made. The tokens are on the state the SDK error carries, so they are
    // recovered here rather than left out of the run's cost.
    const unbilled = usageFromError(error);
    if (unbilled !== null) {
      tracker.addTokens(unbilled);
      cost = computeCost(priceTable, model, tracker.tokenUsage);
    }
    const reason = toFailureReason(failure);
    await trajectory.append({ type: 'error', reason, message: describeError(failure) });
    runLogger.warn('run.error', { reason, message: describeError(failure) });
    outcome =
      reason === 'budget-exhausted'
        ? {
            status: 'budget-exhausted',
            limit: tracker.hitLimit ?? 'tool-calls',
            detail: describeError(failure),
          }
        : { status: 'failed', reason, detail: describeError(failure) };
  } finally {
    clearTimeout(deadlineTimer);
  }

  // A run that ran out of budget may still have written a working fix, so the
  // patch and the oracle run happen no matter how the agent phase ended.
  const repaired = await readFileMap(paths.workspaceDir);
  const patchText = createUnifiedDiff(pristine, repaired);
  await writePatch(paths, patchText);
  const patch = summarizePatch(patchText, paths.patchPath);

  const final = await finalVerification({
    patch,
    interim,
    retried,
    hasOracle: options.oracle != null,
    verifyIndependently,
  });

  await writeVerificationLog(paths, final.log);

  if (outcome.status === 'no-patch' && patch.kind === 'present') {
    outcome =
      final.outcome.kind === 'passed'
        ? { status: 'repaired' }
        : {
            status: 'unverified-patch',
            detail:
              final.outcome.kind === 'skipped'
                ? 'a patch was produced but no oracle verified it'
                : `the hidden oracle did not pass: ${final.outcome.kind}`,
          };
  } else if (
    outcome.status === 'budget-exhausted' &&
    patch.kind === 'present' &&
    final.outcome.kind === 'passed'
  ) {
    outcome = { status: 'repaired' };
  }

  const checksumAfter = await treeChecksum(repoPath);
  const mutated = checksumAfter !== checksumBefore;
  if (mutated) {
    await trajectory.append({
      type: 'error',
      reason: 'source-mutated',
      message: 'the input repository changed during the run',
    });
    outcome = {
      status: 'failed',
      reason: 'source-mutated',
      detail: 'the input repository changed during the run; the result is not trustworthy',
    };
  }

  const finishedAt = new Date();
  await trajectory.append({
    type: 'run.finished',
    status: outcome.status,
    wallClockMs: finishedAt.getTime() - startedAt.getTime(),
  });

  const result: RunResult = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId,
    caseId: options.caseId ?? null,
    mode: options.mode,
    model,
    modelSettingsFingerprint: fingerprintModelSettings(settings),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    sandbox: executor.profile,
    repo: {
      inputPath: repoPath,
      workspacePath: paths.workspaceDir,
      treeChecksumBefore: checksumBefore,
      treeChecksumAfter: checksumAfter,
      mutated,
      fileCount: copyReport.fileCount,
    },
    budget,
    usage: tracker.snapshot(cost),
    outcome,
    verification: final.outcome,
    patch,
    artifacts: {
      runDir: paths.runDir,
      resultPath: paths.resultPath,
      trajectoryPath: paths.trajectoryPath,
      patchPath: paths.patchPath,
      verificationLogPath: paths.verificationLogPath,
      reportPath: paths.reportPath,
    },
  };

  await writeRunResult(paths, result);
  await renderRunReport(result, patchText, final.log, hypotheses);
  runLogger.info('run.finished', { status: outcome.status, verification: final.outcome.kind });
  return result;
}

interface FinalVerificationInput {
  readonly patch: PatchSummary;
  readonly interim: VerificationRun | null;
  readonly retried: boolean;
  readonly hasOracle: boolean;
  readonly verifyIndependently: (stage: VerificationStage) => Promise<VerificationRun | null>;
}

/**
 * The verdict. When the interim run already covered the final tree, that is,
 * nothing was patched after it, its result is reused rather than spending a
 * second oracle execution on an identical workspace.
 */
async function finalVerification(input: FinalVerificationInput): Promise<VerificationRun> {
  if (!input.hasOracle) {
    return {
      outcome: { kind: 'skipped', why: 'no-oracle-registered' },
      log: 'no hidden oracle is registered for this repository, so no independent verification ran\n',
    };
  }
  if (input.patch.kind === 'empty') {
    return {
      outcome: { kind: 'skipped', why: 'no-patch-produced' },
      log: 'the agent produced no patch, so the oracle was not run\n',
    };
  }
  if (input.interim !== null && !input.retried) {
    return {
      outcome: input.interim.outcome,
      log: `${input.interim.log}\nno patch attempt followed this run, so it is also the final verification\n`,
    };
  }
  const run = await input.verifyIndependently('final');
  return (
    run ?? {
      outcome: { kind: 'skipped', why: 'no-oracle-registered' },
      log: 'no hidden oracle is registered for this repository, so no independent verification ran\n',
    }
  );
}

async function recordAssistantTurn(trajectory: TrajectoryWriter, turn: DriverTurn): Promise<void> {
  await trajectory.append({ type: 'model.message', role: 'assistant', text: turn.text });
}

function accountFor(
  tracker: BudgetTracker,
  turn: DriverTurn,
  priceTable: PriceTable,
  model: string,
): Cost {
  if (turn.usage !== null) {
    tracker.addTokens(turn.usage);
  }
  const cost = computeCost(priceTable, model, tracker.tokenUsage);
  tracker.assertCost(cost);
  return cost;
}

interface GateResult {
  readonly passed: boolean;
  readonly label: string;
  readonly exitCode: number | null;
  readonly detail: string;
}

/**
 * Advanced mode's independent evidence gate. The harness, not the model, runs
 * the repository's own check command and reads the exit status. The model's
 * claim of success carries no weight here.
 */
async function runEvidenceGate(
  executor: SandboxExecutor,
  tracker: BudgetTracker,
  trajectory: TrajectoryWriter,
  workspacePath: string,
  attempt: number,
  explicitCheck: CheckCommand | null,
): Promise<GateResult> {
  tracker.assertWallClock();
  const manifest = await readManifest(workspacePath);
  const check = checkCommandFor(manifest, explicitCheck);
  const outcome = await executor.run({
    command: check.command,
    args: check.args,
    timeoutMs: tracker.commandTimeoutMs(),
  });
  const passed = outcome.kind === 'exited' && outcome.exitCode === 0;
  const exitCode = outcomeExitCode(outcome);
  const text = clamp(redactText(renderExecOutcome(outcome)));
  await trajectory.append({
    type: 'evidence.gate',
    attempt,
    passed,
    command: check.label,
    exitCode,
    detail: text.slice(0, 2000),
  });
  return {
    passed,
    label: check.label,
    exitCode,
    detail: `${check.label}\n${text}`,
  };
}

/**
 * Turns an oracle outcome into feedback the agent may see: the check lines it
 * printed, with any host path replaced first. The oracle's location, its source
 * and the run's own directory never cross back into the conversation.
 */
export function sanitizeFindings(
  outcome: VerificationOutcome,
  runDir: string,
  oracle: HiddenOracle | null | undefined,
): string[] {
  const lines =
    outcome.kind === 'passed' || outcome.kind === 'failed'
      ? outcome.checks
      : [`the verification did not complete: ${outcome.kind}`];
  return lines.map((line) => {
    let scrubbed = line.split(runDir).join('<workspace>');
    if (oracle != null) {
      scrubbed = scrubbed.split(oracle.directory).join('<verification>');
      scrubbed = scrubbed.split(oracle.entry).join('<verification>');
    }
    // Anything still carrying an absolute path is reduced to its basename.
    scrubbed = scrubbed.replace(/(?:\/[\w.@+-]+){2,}/gu, (match) => `<path>/${path.basename(match)}`);
    return redactText(scrubbed);
  });
}

function criticMessage(
  patchText: string,
  hypotheses: readonly Hypothesis[],
  evidence: string,
): string {
  return [
    'Hypothesis ledger:',
    renderLedger(hypotheses),
    '',
    'Proposed patch:',
    patchText.length === 0 ? '(the agent changed nothing)' : patchText,
    '',
    'Evidence collected after the patch:',
    evidence,
  ].join('\n');
}

function summarizePatch(patchText: string, patchPath: string): PatchSummary {
  if (patchText.trim().length === 0) {
    return { kind: 'empty', path: patchPath };
  }
  const parsed = parseUnifiedDiff(patchText);
  const counts = countPatchLines(patchText);
  return {
    kind: 'present',
    path: patchPath,
    // Over the exact bytes written to repair.patch, which is what apply reads.
    sha256: sha256(patchText),
    changedFiles: parsed.files.map((file) => file.path),
    addedLines: counts.added,
    removedLines: counts.removed,
    sensitive: true,
  };
}
