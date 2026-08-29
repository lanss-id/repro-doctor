import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Points artifact output at a throwaway directory for the current test file.
 * Must be called before anything reads artifactsRoot().
 */
export async function useTemporaryArtifacts(prefix: string): Promise<{
  readonly root: string;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), `repro-doctor-${prefix}-`));
  process.env['REPRO_DOCTOR_ARTIFACTS_DIR'] = root;
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function temporaryDirectory(prefix: string): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), `repro-doctor-${prefix}-`));
}

export async function removeDirectory(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}
