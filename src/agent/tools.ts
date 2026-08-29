import { tool } from '@openai/agents';
import { z } from 'zod';
import { ALLOWED_COMMANDS } from '../infra/exec/allowlist.js';
import type { RepairSession } from './session.js';

/**
 * The tool set. Built once and shared by both modes: same names, same
 * descriptions, same schemas, same implementation. If these ever diverge per
 * mode, the comparison stops meaning anything.
 */
function withBudget(session: RepairSession, text: string): string {
  return `${text}\n\n${session.budgetFooter()}`;
}

export function buildTools(session: RepairSession): ReturnType<typeof tool>[] {
  const listFiles = tool({
    name: 'list_files',
    description: 'List the entries of a directory inside the repository, relative to its root.',
    parameters: z.object({
      directory: z.string().describe('Directory relative to the repository root. Use "." for the root.'),
    }),
    isEnabled: () => session.agentToolsEnabled,
    async execute({ directory }) {
      const result = await session.listFiles(directory);
      return withBudget(session, result.text);
    },
  });

  const readFile = tool({
    name: 'read_file',
    description: 'Read one UTF-8 text file from the repository.',
    parameters: z.object({
      path: z.string().describe('File path relative to the repository root.'),
    }),
    isEnabled: () => session.agentToolsEnabled,
    async execute({ path: filePath }) {
      const result = await session.readFile(filePath);
      return withBudget(session, result.text);
    },
  });

  const runCommand = tool({
    name: 'run_command',
    description: [
      'Run one command inside the sandbox, from the repository root. There is no network access.',
      `Allowed commands: ${ALLOWED_COMMANDS.join(', ')}.`,
      'Arguments are passed directly to the process; shell syntax such as pipes and redirection does not work.',
    ].join(' '),
    parameters: z.object({
      command: z.string().describe('Executable name, for example "npm".'),
      args: z.array(z.string()).describe('Arguments, for example ["run", "check"].'),
    }),
    isEnabled: () => session.agentToolsEnabled,
    async execute({ command, args }) {
      const result = await session.runCommand(command, args);
      return withBudget(session, result.text);
    },
  });

  const proposePatch = tool({
    name: 'propose_patch',
    description: [
      'Write the full new contents of one or more files. This is how you change the repository.',
      'Each call counts as one patch attempt, and attempts are strictly limited.',
    ].join(' '),
    parameters: z.object({
      rationale: z.string().describe('One or two sentences on why this change fixes the fault.'),
      files: z
        .array(
          z.object({
            path: z.string().describe('File path relative to the repository root.'),
            content: z.string().describe('Complete new contents of the file.'),
          }),
        )
        .describe('Files to write. Existing files are replaced; missing ones are created.'),
    }),
    isEnabled: () => session.agentToolsEnabled,
    async execute({ files, rationale }) {
      const result = await session.proposePatch(files, rationale);
      return withBudget(session, result.text);
    },
  });

  return [listFiles, readFile, runCommand, proposePatch];
}
