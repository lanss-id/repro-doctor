import path from 'node:path';
import { parseCheckCommand } from '../../agent/check-command.js';
import { ReproDoctorError } from '../../domain/failure.js';
import { ExecutorKindSchema } from '../../domain/result.js';
import { describeVerification } from '../../domain/verification.js';
import { findFixtureForRepo } from '../../fixtures/registry.js';
import { verifyExternalPatch } from '../../verify/external-patch.js';
import { assertKnownFlags, numberFlag, requiredStringFlag, stringFlag, type ParsedArgs } from '../args.js';
import { ORACLE_FLAGS, resolveOracle } from '../oracle-args.js';
import type { Presenter } from '../presenter.js';

const KNOWN_FLAGS = ['patch', ...ORACLE_FLAGS, 'executor', 'check-command', 'command-timeout', 'oracle-failure-contract'];

/**
 * Exit status is the verdict, so a CI job can gate on it: 0 only for `verified`,
 * which here means the hidden oracle passed the patched copy AND failed an
 * assertion on the unpatched one. Agent runs (`run`) are not given the baseline check: their
 * `verified`/`passed` records only that the oracle passed the repaired copy.
 */
export async function verifyCommand(args: ParsedArgs, presenter: Presenter): Promise<number> {
  assertKnownFlags(args, KNOWN_FLAGS);
  const repoArg = args.positionals[1];
  if (repoArg === undefined) {
    throw new ReproDoctorError('internal-error', 'verify needs a repository path');
  }
  const repoPath = path.resolve(repoArg);
  const patchPath = requiredStringFlag(args, 'patch');
  const oracle = resolveOracle(args, await findFixtureForRepo(repoPath));
  if (oracle === null) {
    throw new ReproDoctorError(
      'oracle-missing',
      'verify needs a hidden oracle',
      'Pass --oracle-dir. Without one the only evidence is a check the patch author could see, which is what this command exists not to trust.',
    );
  }
  const checkFlag = stringFlag(args, 'check-command');
  const checkCommand = checkFlag === null ? null : parseCheckCommand(checkFlag);
  if (checkFlag !== null && checkCommand === null) {
    throw new ReproDoctorError('internal-error', '--check-command was empty');
  }
  const contractFlag = stringFlag(args, 'oracle-failure-contract');
  if (contractFlag !== null && contractFlag !== 'exit-status' && contractFlag !== 'reported-check') {
    throw new ReproDoctorError('internal-error', '--oracle-failure-contract must be exit-status or reported-check');
  }
  const executorFlag = stringFlag(args, 'executor');

  presenter.heading('Verify');
  presenter.keyValue('repository', repoPath);
  presenter.keyValue('patch', path.resolve(patchPath));
  presenter.keyValue('hidden oracle', oracle.id);

  const result = await verifyExternalPatch({
    repoPath,
    patchPath,
    oracle,
    checkCommand,
    commandTimeoutSeconds: numberFlag(args, 'command-timeout') ?? 60,
    ...(contractFlag === null ? {} : { oracleFailureContract: contractFlag }),
    ...(executorFlag === null ? {} : { executorKind: ExecutorKindSchema.parse(executorFlag) }),
  });

  presenter.heading('Result');
  presenter.keyValue('id', result.id);
  presenter.keyValue('verdict', result.status);
  presenter.keyValue('detail', result.detail);
  presenter.keyValue(
    'patch',
    `${result.patch.changedFiles.length} file(s), +${result.patch.addedLines}/-${result.patch.removedLines}, sha256 ${result.patch.sha256}`,
  );
  presenter.keyValue(
    'visible check',
    result.visibleCheck === null
      ? 'not run'
      : `${result.visibleCheck.command}: ${result.visibleCheck.passed ? 'passed' : `failed (exit ${result.visibleCheck.exitCode ?? 'none'})`}`,
  );
  presenter.keyValue('hidden oracle', describeVerification(result.verification));
  presenter.keyValue('oracle digest', result.oracle.digest);
  presenter.keyValue(
    'oracle on unpatched repo',
    result.oracle.baseline === null ? 'not run' : describeVerification(result.oracle.baseline),
  );
  presenter.keyValue(
    'baseline basis',
    result.oracle.baselineBasis ?? 'none (the oracle was not shown to fail an assertion without the patch)',
  );
  presenter.keyValue(
    'oracle scope',
    `content snapshot only (${result.oracle.symlinkCount} symlinks, stable during run: ${result.oracle.digestStable ? 'yes' : 'NO'}); a failing baseline shows the oracle reacts to the patch, not that it covers the whole bug`,
  );
  presenter.keyValue('input repository', result.repo.mutated ? 'CHANGED (this is a bug)' : 'unchanged');

  presenter.heading('Artifacts');
  presenter.bullet(result.artifacts.resultPath);
  presenter.bullet(result.artifacts.patchPath);
  presenter.bullet(result.artifacts.checkLogPath);
  presenter.bullet(result.artifacts.verificationLogPath);

  return result.status === 'verified' ? 0 : 1;
}
