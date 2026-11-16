import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkCommandFor, readManifest, type CheckCommand } from '../agent/check-command.js';
import { clamp, renderExecOutcome } from '../agent/session.js';
import { writeAppliedFiles } from '../apply/apply.js';
import { ReproDoctorError, describeError } from '../domain/failure.js';
import { newRunId, type RunId } from '../domain/ids.js';
import {
  PATCH_CHECK_SCHEMA_VERSION,
  PatchCheckResultSchema,
  type OracleEvidence,
  type PatchCheckResult,
  type PatchCheckStatus,
} from '../domain/patch-check.js';
import type { ExecutorKind, SandboxProfile } from '../domain/result.js';
import type { VerificationOutcome } from '../domain/verification.js';
import {
  applyUnifiedDiff,
  countPatchLines,
  parseUnifiedDiff,
  type ParsedPatch,
} from '../infra/diff/unified.js';
import { createExecutor } from '../infra/exec/factory.js';
import { outcomeExitCode } from '../infra/exec/types.js';
import { sha256, treeChecksum } from '../infra/fs/checksum.js';
import { copyRepositoryToWorkspace } from '../infra/fs/copy.js';
import { assertRealPathInside, isInside, resolveWithin } from '../infra/fs/paths.js';
import { artifactsRoot } from '../infra/project-root.js';
import { redactText } from '../infra/redact.js';
import { runHiddenOracle, type HiddenOracle } from '../oracle/verify.js';

export interface ExternalPatchRequest {
  readonly repoPath: string;
  readonly patchPath: string;
  readonly oracle: HiddenOracle;
  readonly checkCommand?: CheckCommand | null;
  readonly commandTimeoutSeconds: number;
  readonly executorKind?: ExecutorKind;
  readonly allowLocalAdapter?: boolean;
  readonly id?: RunId;
}

export function verificationsRoot(): string {
  return path.join(artifactsRoot(), 'verifications');
}

/**
 * Judges a patch Repro Doctor did not write.
 *
 * The patch is applied, exactly and without fuzz, to a copy of the repository.
 * The repository's own check runs in the repair sandbox, then the hidden oracle
 * runs on a second fresh copy with its directory mounted read-only. The input
 * repository is checksummed before and after and never written to.
 */
export async function verifyExternalPatch(request: ExternalPatchRequest): Promise<PatchCheckResult> {
  const startedAt = new Date();
  const repoPath = path.resolve(request.repoPath);
  const repoStats = await stat(repoPath).catch(() => null);
  if (repoStats === null || !repoStats.isDirectory()) {
    throw new ReproDoctorError('unsafe-path', `repository not found: ${repoPath}`);
  }
  if (isInside(artifactsRoot(), repoPath)) {
    throw new ReproDoctorError(
      'unsafe-path',
      'refusing to verify against a path inside artifacts/; point at the original repository instead',
    );
  }
  const patchPath = path.resolve(request.patchPath);
  const patchText = await readFile(patchPath, 'utf8').catch(() => null);
  if (patchText === null) {
    throw new ReproDoctorError('patch-invalid', `patch file not found: ${patchPath}`);
  }
  // A patch that is not a unified diff at all is the caller's mistake, not a
  // verdict on the change, so it stops here before anything is written.
  const parsed = parseUnifiedDiff(patchText);
  const lineCounts = countPatchLines(patchText);

  const id = request.id ?? newRunId(startedAt);
  const dir = path.join(verificationsRoot(), id);
  const workspace = path.join(dir, 'workspace');
  const paths = {
    dir,
    resultPath: path.join(dir, 'verification.json'),
    patchPath: path.join(dir, 'submitted.patch'),
    checkLogPath: path.join(dir, 'check.log'),
    verificationLogPath: path.join(dir, 'verification.log'),
  };
  await mkdir(dir, { recursive: true });
  // The exact bytes that were judged, so the sha256 below can be re-derived.
  await writeFile(paths.patchPath, patchText, 'utf8');

  const checksumBefore = await treeChecksum(repoPath);
  // No ignore list: every file in the oracle directory can be an executable input, including node_modules and dist.
  const oracleDigest = await treeChecksum(request.oracle.directory, []);
  let baseline: VerificationOutcome | null = null;
  await copyRepositoryToWorkspace(repoPath, workspace);

  let status: PatchCheckStatus;
  let detail: string;
  let visibleCheck: PatchCheckResult['visibleCheck'] = null;
  let verification: VerificationOutcome;
  let sandbox: SandboxProfile | null = null;
  let checkLog: string;
  let verificationLog: string;

  const applyError = await applyToWorkspace(workspace, parsed);
  if (applyError !== null) {
    status = 'does-not-apply';
    detail = applyError;
    verification = { kind: 'skipped', why: 'patch-did-not-apply' };
    checkLog = `the patch did not apply, so nothing was run\n${applyError}\n`;
    verificationLog = checkLog;
  } else {
    const executor = await createExecutor({
      kind: request.executorKind ?? 'docker',
      workspacePath: workspace,
      commandTimeoutSeconds: request.commandTimeoutSeconds,
      purpose: 'repair',
      ...(request.allowLocalAdapter === undefined ? {} : { allowLocalAdapter: request.allowLocalAdapter }),
    });
    sandbox = executor.profile;
    const check = checkCommandFor(await readManifest(workspace), request.checkCommand ?? null);
    const outcome = await executor.run({
      command: check.command,
      args: check.args,
      timeoutMs: request.commandTimeoutSeconds * 1000,
    });
    visibleCheck = {
      command: check.label,
      passed: outcome.kind === 'exited' && outcome.exitCode === 0,
      exitCode: outcomeExitCode(outcome),
    };
    checkLog = `command: ${check.label}\n${clamp(renderExecOutcome(outcome), 200_000)}\n`;

    let oracleRun: { outcome: VerificationOutcome; log: string };
    try {
      oracleRun = await runHiddenOracle({
        oracle: request.oracle,
        repairedWorkspace: workspace,
        scratchDirectory: path.join(dir, 'verify'),
        executorKind: request.executorKind ?? 'docker',
        ...(request.allowLocalAdapter === undefined ? {} : { allowLocalAdapter: request.allowLocalAdapter }),
      });
    } catch (error) {
      oracleRun = {
        outcome: { kind: 'oracle-error', message: describeError(error) },
        log: `oracle failed to run: ${describeError(error)}\n`,
      };
    }
    verification = oracleRun.outcome;
    verificationLog = oracleRun.log;

    // The same oracle on the unpatched copy. A pass here means the oracle
    // cannot tell this fix from no fix, so a pass on the patched tree is not
    // evidence of a repair.
    if (verification.kind === 'passed') {
      baseline = await runBaseline(request, repoPath, dir);
    }
    status = verification.kind === 'passed' ? 'verified' : 'rejected';
    detail =
      verification.kind === 'passed'
        ? `the hidden oracle passed${visibleCheck.passed ? '' : `, although ${check.label} did not`}`
        : `the hidden oracle did not pass: ${verification.kind}`;
    if (verification.kind === 'passed' && !baselineShowsAssertionFailure(baseline)) {
      status = 'inconclusive';
      detail = `the hidden oracle passed with the patch, but it was not shown to fail an assertion without it (unpatched run: ${describeBaseline(baseline)}); the pass does not demonstrate a repair`;
    }
  }

  const checksumAfter = await treeChecksum(repoPath);
  const mutated = checksumAfter !== checksumBefore;
  if (mutated) {
    status = 'source-mutated';
    detail = 'the input repository changed while the patch was being verified; the verdict is not trustworthy';
  }

  const result = PatchCheckResultSchema.parse({
    schemaVersion: PATCH_CHECK_SCHEMA_VERSION,
    id,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    detail,
    patch: {
      sourcePath: patchPath,
      sha256: sha256(patchText),
      changedFiles: parsed.files.map((file) => file.path),
      addedLines: lineCounts.added,
      removedLines: lineCounts.removed,
    },
    repo: { inputPath: repoPath, treeChecksumBefore: checksumBefore, treeChecksumAfter: checksumAfter, mutated },
    oracleId: request.oracle.id,
    oracle: {
      id: request.oracle.id,
      entry: request.oracle.entry,
      digest: oracleDigest,
      baseline,
      discriminates: discriminates(baseline),
    } satisfies OracleEvidence,
    visibleCheck,
    verification,
    sandbox,
    artifacts: paths,
  });
  await writeFile(paths.checkLogPath, redactText(checkLog), 'utf8');
  await writeFile(paths.verificationLogPath, redactText(verificationLog), 'utf8');
  await writeFile(paths.resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

/**
 * Applies the patch to the workspace copy, or says why it cannot be.
 *
 * Only the files the patch names are read, directly, rather than snapshotting
 * the tree: the snapshot skips build output, binaries and large files, and a
 * patch touching one of those would be reported as targeting a missing file.
 */
async function applyToWorkspace(workspace: string, patch: ParsedPatch): Promise<string | null> {
  try {
    const current = new Map<string, string>();
    for (const file of patch.files) {
      const absolute = resolveWithin(workspace, file.path);
      const contents = await readFile(absolute, 'utf8').catch(() => null);
      if (contents !== null) {
        await assertRealPathInside(workspace, absolute);
        current.set(file.path, contents);
      }
    }
    await writeAppliedFiles(workspace, applyUnifiedDiff(current, patch).files);
    return null;
  } catch (error) {
    if (error instanceof ReproDoctorError && (error.reason === 'patch-invalid' || error.reason === 'unsafe-path')) {
      return error.detail === undefined ? error.message : `${error.message} (${error.detail})`;
    }
    throw error;
  }
}

async function runBaseline(
  request: ExternalPatchRequest,
  repoPath: string,
  dir: string,
): Promise<VerificationOutcome> {
  try {
    const run = await runHiddenOracle({
      oracle: request.oracle,
      repairedWorkspace: repoPath,
      scratchDirectory: path.join(dir, 'baseline'),
      executorKind: request.executorKind ?? 'docker',
      ...(request.allowLocalAdapter === undefined ? {} : { allowLocalAdapter: request.allowLocalAdapter }),
    });
    await writeFile(path.join(dir, 'baseline.log'), redactText(run.log), 'utf8');
    return run.outcome;
  } catch (error) {
    return { kind: 'oracle-error', message: describeError(error) };
  }
}

/**
 * A non-zero exit alone is not evidence the oracle discriminates: a missing
 * dependency or a crash exits non-zero too. Only an exit that also reports at
 * least one failed check (an `[oracle] FAIL ...` line) counts as an assertion.
 */
function baselineShowsAssertionFailure(baseline: VerificationOutcome | null): boolean {
  return baseline?.kind === 'failed' && baseline.checks.some((check) => check.startsWith('FAIL '));
}

function discriminates(baseline: VerificationOutcome | null): boolean | null {
  if (baseline === null) {
    return null;
  }
  if (baseline.kind === 'passed') {
    return false;
  }
  return baselineShowsAssertionFailure(baseline) ? true : null;
}

function describeBaseline(baseline: VerificationOutcome | null): string {
  if (baseline === null) {
    return 'not run';
  }
  if (baseline.kind === 'failed' && !baselineShowsAssertionFailure(baseline)) {
    return `exit ${baseline.exitCode} with no failed check reported, which may be a crash or setup error`;
  }
  return baseline.kind;
}
