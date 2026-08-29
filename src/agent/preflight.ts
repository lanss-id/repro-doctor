import type { TrajectoryWriter } from '../infra/artifacts.js';
import { checkCommandFor, readManifest, type CheckCommand } from './check-command.js';
import type { RepairSession } from './session.js';

export interface PreflightReport {
  readonly findings: readonly string[];
  readonly checkCommand: CheckCommand;
  readonly text: string;
  readonly toolCallsUsed: number;
}

/**
 * Advanced mode only. Runs a fixed, model-free sequence before the agent sees
 * the task, so the first hypothesis is formed against real output instead of a
 * guess about an unfamiliar layout.
 *
 * Every step goes through the same RepairSession the agent uses, which means
 * each one is charged to the same budget. The structure is free of model
 * randomness, not free of cost.
 */
export async function runPreflight(
  session: RepairSession,
  trajectory: TrajectoryWriter,
): Promise<PreflightReport> {
  const findings: string[] = [];
  const sections: string[] = [];
  let toolCallsUsed = 0;

  const listing = await session.listFiles('.');
  toolCallsUsed += 1;
  sections.push(`Repository root:\n${listing.text}`);
  findings.push(`root entries: ${listing.text.split('\n').length}`);

  const manifestOutput = await session.readFile('package.json');
  toolCallsUsed += 1;
  sections.push(`package.json:\n${manifestOutput.text}`);
  if (!manifestOutput.ok) {
    findings.push('package.json is unreadable');
  }

  const manifest = await readManifest(session.workspacePath);
  const checkCommand = checkCommandFor(manifest);
  findings.push(`check command resolved from ${checkCommand.source}: ${checkCommand.label}`);

  const check = await session.runCommand(checkCommand.command, checkCommand.args);
  toolCallsUsed += 1;
  sections.push(`${checkCommand.label}:\n${check.text}`);
  findings.push(check.ok ? 'check command passed before any change' : 'check command failed before any change');

  const text = [
    'PREFLIGHT REPORT (produced by the harness, not by a model; already charged to your budget)',
    '',
    ...sections,
    '',
    [
      `This preflight spent ${toolCallsUsed} tool calls from your budget. ${session.budgetFooter()}`,
      `Remaining work: form hypotheses from the output above. Do not re-run ${checkCommand.label} until you have patched something.`,
    ].join('\n'),
  ].join('\n\n');

  await trajectory.append({
    type: 'preflight.completed',
    findings,
    commandsRun: toolCallsUsed,
  });

  return { findings, checkCommand, text, toolCallsUsed };
}
