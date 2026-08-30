#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { ReproDoctorError, describeError } from '../domain/failure.js';
import { createLogger } from '../infra/log.js';
import { parseArgv } from './args.js';
import { applyCommand } from './commands/apply.js';
import { diagnoseCommand } from './commands/diagnose.js';
import { evalCommand } from './commands/eval.js';
import { fixturesCommand } from './commands/fixtures.js';
import { replayCommand } from './commands/replay.js';
import { reportCommand } from './commands/report.js';
import { HELP_TEXT, createPresenter } from './presenter.js';

const USAGE_EXIT_CODE = 2;

export async function main(argv: readonly string[]): Promise<number> {
  const presenter = createPresenter();
  const args = parseArgv(argv);
  const command = args.positionals[0];

  if (command === undefined || command === 'help' || args.flags.has('help')) {
    presenter.block(HELP_TEXT);
    return command === undefined && !args.flags.has('help') ? USAGE_EXIT_CODE : 0;
  }

  switch (command) {
    case 'diagnose':
      return await diagnoseCommand(args, presenter);
    case 'apply':
      return await applyCommand(args, presenter);
    case 'eval':
      return await evalCommand(args, presenter);
    case 'report':
      return await reportCommand(args, presenter);
    case 'replay':
      return await replayCommand(args, presenter);
    case 'fixtures':
      return await fixturesCommand(args, presenter);
    default:
      presenter.line(`Unknown command: ${command}`);
      presenter.line();
      presenter.block(HELP_TEXT);
      return USAGE_EXIT_CODE;
  }
}

const entryPath = process.argv[1];
const isEntryPoint = entryPath !== undefined && pathToFileURL(entryPath).href === import.meta.url;

if (isEntryPoint) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const logger = createLogger();
      if (error instanceof ReproDoctorError) {
        logger.error('command.failed', { reason: error.reason, message: error.message });
        if (error.detail !== undefined) {
          logger.error('command.failed.detail', { detail: error.detail });
        }
        process.exitCode = error.reason === 'internal-error' ? USAGE_EXIT_CODE : 1;
        return;
      }
      logger.error('command.crashed', { message: describeError(error) });
      process.exitCode = 1;
    });
}
