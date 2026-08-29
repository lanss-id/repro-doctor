import path from 'node:path';
import type { SandboxProfile } from '../../domain/result.js';
import { assertRealPathInside, resolveWithin } from '../fs/paths.js';
import { assertAllowedCommand } from './allowlist.js';
import { spawnCaptured } from './spawn.js';
import type { ExecOutcome, ExecRequest, SandboxExecutor } from './types.js';

export interface LocalTestAdapterOptions {
  readonly workspacePath: string;
  readonly commandTimeoutSeconds: number;
  /** Extra directories prepended to PATH, typically the repo's node_modules/.bin. */
  readonly extraPathEntries?: readonly string[];
}

/**
 * TEST ADAPTER, NOT A SANDBOX.
 *
 * Runs commands as ordinary host processes with the working directory pinned to
 * the workspace copy. It exists so the test suite can exercise the full repair
 * and verification pipeline on machines without Docker. It provides no
 * filesystem isolation, no network isolation and no resource limits, so
 * `productionSafe` is false and `diagnose` refuses to select it unless the
 * operator both passes `--executor local-test-adapter` and sets
 * REPRO_DOCTOR_ALLOW_LOCAL_ADAPTER=1.
 */
export class LocalTestAdapter implements SandboxExecutor {
  readonly kind = 'local-test-adapter' as const;
  readonly workspacePath: string;
  readonly profile: SandboxProfile;

  private readonly commandTimeoutSeconds: number;
  private readonly extraPathEntries: readonly string[];

  constructor(options: LocalTestAdapterOptions) {
    this.workspacePath = path.resolve(options.workspacePath);
    this.commandTimeoutSeconds = options.commandTimeoutSeconds;
    this.extraPathEntries = options.extraPathEntries ?? [];
    this.profile = {
      executor: 'local-test-adapter',
      image: null,
      network: 'host-inherited',
      readOnlyRootFilesystem: false,
      noNewPrivileges: false,
      dockerSocketMounted: false,
      oracleMountedDuringRepair: false,
      secretsMounted: false,
      cpuLimit: null,
      memoryLimit: null,
      commandTimeoutSeconds: this.commandTimeoutSeconds,
      productionSafe: false,
    };
  }

  async run(request: ExecRequest): Promise<ExecOutcome> {
    assertAllowedCommand(request.command);
    // Containment goes through the canonical helpers. A raw startsWith would
    // accept a sibling whose name merely begins with the workspace path, such
    // as /tmp/work-escape for /tmp/work.
    const cwd =
      request.workdir === undefined
        ? this.workspacePath
        : resolveWithin(this.workspacePath, request.workdir);
    await assertRealPathInside(this.workspacePath, cwd);
    return await spawnCaptured({
      command: request.command,
      args: request.args,
      cwd,
      env: this.processEnv(request.env),
      timeoutMs: request.timeoutMs,
    });
  }

  /** Rebuilt from scratch so no host API key can reach a sandboxed process. */
  private processEnv(extra: Readonly<Record<string, string>> | undefined): Record<string, string> {
    const basePath = [
      // The Node running the harness comes first. A machine with an old
      // /usr/bin/node would otherwise run the fixtures on the wrong runtime,
      // which the Docker executor never has to worry about.
      path.dirname(process.execPath),
      ...this.extraPathEntries,
      '/usr/local/sbin',
      '/usr/local/bin',
      '/usr/sbin',
      '/usr/bin',
      '/sbin',
      '/bin',
    ].join(path.delimiter);
    return {
      HOME: process.env['HOME'] ?? '/tmp',
      PATH: basePath,
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      NPM_CONFIG_FUND: 'false',
      NPM_CONFIG_AUDIT: 'false',
      CI: '1',
      ...extra,
    };
  }
}
