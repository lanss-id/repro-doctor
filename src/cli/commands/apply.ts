import { createInterface } from 'node:readline/promises';
import { ReproDoctorError } from '../../domain/failure.js';
import { RunIdSchema } from '../../domain/ids.js';
import { commitApply, prepareApply } from '../../apply/apply.js';
import { assertKnownFlags, booleanFlag, requiredStringFlag, type ParsedArgs } from '../args.js';
import type { Presenter } from '../presenter.js';

const KNOWN_FLAGS = ['to', 'yes-i-reviewed-the-patch'];
const CONFIRM_WORD = 'apply';

export type Confirm = (question: string) => Promise<string>;

async function promptOnTerminal(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new ReproDoctorError(
      'internal-error',
      'apply needs an interactive terminal to confirm',
      'Run it in a terminal, or pass --yes-i-reviewed-the-patch to state that a human has read the patch printed above.',
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * Applying a patch is the one action that touches a repository the operator
 * cares about, so it always shows the full diff first, always checks the target
 * is the tree the patch was built against, and never proceeds without an
 * explicit human decision.
 */
export async function applyCommand(
  args: ParsedArgs,
  presenter: Presenter,
  confirm: Confirm = promptOnTerminal,
): Promise<number> {
  assertKnownFlags(args, KNOWN_FLAGS);
  const runIdArg = args.positionals[1];
  if (runIdArg === undefined) {
    throw new ReproDoctorError('internal-error', 'apply needs a run id');
  }
  const runId = RunIdSchema.parse(runIdArg);
  const target = requiredStringFlag(args, 'to');
  const preapproved = booleanFlag(args, 'yes-i-reviewed-the-patch');

  const preview = await prepareApply(runId, target);

  presenter.heading('Patch preview');
  presenter.keyValue('run id', runId);
  presenter.keyValue('mode', preview.result.mode);
  presenter.keyValue('produced by model', preview.result.model);
  presenter.keyValue('verification', preview.result.verification.kind);
  presenter.keyValue('target repository', preview.targetPath);
  presenter.keyValue('target checksum', preview.targetChecksum);
  presenter.keyValue('files changed', preview.changedFiles.join(', '));
  presenter.line();
  presenter.block(preview.patchText);

  if (preview.result.verification.kind !== 'passed') {
    presenter.line(
      `Warning: the hidden oracle did not pass for this run (${preview.result.verification.kind}). You are applying an unverified patch.`,
    );
  }

  if (!preapproved) {
    const answer = await confirm(`Type "${CONFIRM_WORD}" to write these changes to ${preview.targetPath}: `);
    if (answer.trim() !== CONFIRM_WORD) {
      presenter.line('Cancelled. Nothing was written.');
      return 1;
    }
  } else {
    presenter.line('Approval flag --yes-i-reviewed-the-patch was passed, so the prompt was skipped.');
  }

  const outcome = await commitApply(preview);
  presenter.heading('Applied');
  for (const file of outcome.writtenFiles) {
    presenter.bullet(`wrote ${file}`);
  }
  for (const file of outcome.deletedFiles) {
    presenter.bullet(`deleted ${file}`);
  }
  presenter.keyValue('checksum before', preview.targetChecksum);
  presenter.keyValue('checksum after', outcome.checksumAfter);
  return 0;
}
