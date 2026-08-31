import { tool } from '@openai/agents';
import { z } from 'zod';
import { ALLOWED_COMMANDS } from '../infra/exec/allowlist.js';
import { DEFAULT_READ_LINES, MAX_WRITE_BYTES, type RepairSession } from './session.js';

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
    description: [
      'Read one UTF-8 text file from the repository, as a window of lines.',
      'The result says which lines you were given, how many the file has, and how to ask for the ones below them.',
      `A window is at most ${DEFAULT_READ_LINES} lines, and shorter when the lines are long.`,
    ].join(' '),
    parameters: z.object({
      path: z.string().describe('File path relative to the repository root.'),
      start_line: z
        .number()
        .int()
        .nullable()
        .describe('First line to return, counting from 1. Null starts at the top of the file.'),
      max_lines: z
        .number()
        .int()
        .nullable()
        .describe(`How many lines to return. Null returns up to ${DEFAULT_READ_LINES}.`),
    }),
    isEnabled: () => session.agentToolsEnabled,
    async execute({ path: filePath, start_line: startLine, max_lines: maxLines }) {
      const result = await session.readFile(
        filePath,
        startLine ?? 1,
        maxLines ?? DEFAULT_READ_LINES,
      );
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
      'Change one or more files. This is how you change the repository.',
      'Per file, either write its complete new contents, or replace one exact block of text inside it.',
      `Whole-file contents are limited to ${MAX_WRITE_BYTES} bytes, so a larger file has to be changed by replacing a block.`,
      'Each call counts as one patch attempt, and attempts are strictly limited.',
    ].join(' '),
    parameters: z.object({
      rationale: z.string().describe('One or two sentences on why this change fixes the fault.'),
      files: z
        .array(
          z.object({
            path: z.string().describe('File path relative to the repository root.'),
            how: z
              .enum(['whole', 'replace'])
              .describe(
                'Which shape this entry is. "whole" writes content over the file. "replace" swaps the text in find for the text in replacement, leaving the rest of the file alone. Fields belonging to the other shape are ignored.',
              ),
            content: z
              .string()
              .describe(
                'Complete new contents of the file, when how is "whole". Send an empty string when how is "replace".',
              ),
            find: z
              .string()
              .describe(
                'Exact text to replace, when how is "replace". Copy it from a read of this file, including its indentation. It must occur exactly once, so include enough surrounding lines to be unique. Send an empty string when how is "whole".',
              ),
            replacement: z
              .string()
              .describe(
                'What to put in place of find, when how is "replace". An empty string deletes the block. Send an empty string when how is "whole".',
              ),
          }),
        )
        .describe('Files to change. Existing files are replaced or edited; missing ones are created.'),
    }),
    isEnabled: () => session.agentToolsEnabled,
    async execute({ files, rationale }) {
      const result = await session.proposePatch(files, rationale);
      return withBudget(session, result.text);
    },
  });

  return [listFiles, readFile, runCommand, proposePatch];
}
