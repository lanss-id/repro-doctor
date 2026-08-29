import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { ReproDoctorError } from '../../domain/failure.js';
import type { SandboxProfile } from '../../domain/result.js';
import { assertAllowedCommand } from './allowlist.js';
import { spawnCaptured } from './spawn.js';
import type { ExecOutcome, ExecRequest, SandboxExecutor } from './types.js';

export const DEFAULT_RUNNER_IMAGE = 'repro-doctor-runner:1';

export interface DockerExecutorOptions {
  readonly workspacePath: string;
  readonly image?: string;
  readonly cpuLimit?: string;
  readonly memoryLimit?: string;
  readonly commandTimeoutSeconds: number;
  /**
   * `repair` refuses every extra mount. `verify` allows read-only mounts, which
   * is how the hidden oracle enters the container after the agent is done.
   */
  readonly purpose: 'repair' | 'verify';
  /**
   * Whether the host accepts `--security-opt no-new-privileges`. Determined by
   * {@link probeNoNewPrivileges}, never assumed.
   */
  readonly noNewPrivileges: boolean;
}

const CONTAINER_WORKDIR = '/work';

/**
 * The production isolation boundary: one container per command, no network, no
 * Docker socket, no host filesystem beyond the copied workspace.
 */
export class DockerExecutor implements SandboxExecutor {
  readonly kind = 'docker' as const;
  readonly workspacePath: string;
  readonly profile: SandboxProfile;

  private readonly image: string;
  private readonly cpuLimit: string;
  private readonly memoryLimit: string;
  private readonly commandTimeoutSeconds: number;
  private readonly purpose: 'repair' | 'verify';
  private readonly noNewPrivileges: boolean;

  constructor(options: DockerExecutorOptions) {
    this.workspacePath = path.resolve(options.workspacePath);
    this.image = options.image ?? process.env['REPRO_DOCTOR_RUNNER_IMAGE'] ?? DEFAULT_RUNNER_IMAGE;
    this.cpuLimit = options.cpuLimit ?? '1';
    this.memoryLimit = options.memoryLimit ?? '1g';
    this.commandTimeoutSeconds = options.commandTimeoutSeconds;
    this.purpose = options.purpose;
    this.noNewPrivileges = options.noNewPrivileges;
    this.profile = {
      executor: 'docker',
      image: this.image,
      network: 'none',
      readOnlyRootFilesystem: true,
      noNewPrivileges: this.noNewPrivileges,
      dockerSocketMounted: false,
      oracleMountedDuringRepair: false,
      secretsMounted: false,
      cpuLimit: this.cpuLimit,
      memoryLimit: this.memoryLimit,
      commandTimeoutSeconds: this.commandTimeoutSeconds,
      productionSafe: true,
    };
  }

  async run(request: ExecRequest): Promise<ExecOutcome> {
    assertAllowedCommand(request.command);
    const mounts = request.readOnlyMounts ?? [];
    if (this.purpose === 'repair' && mounts.length > 0) {
      throw new ReproDoctorError(
        'unsafe-path',
        'the repair sandbox refuses extra mounts; the oracle is never visible during repair',
      );
    }

    const containerName = `repro-doctor-${randomBytes(6).toString('hex')}`;
    const workdir =
      request.workdir === undefined
        ? CONTAINER_WORKDIR
        : path.posix.join(CONTAINER_WORKDIR, request.workdir);

    const args: string[] = [
      'run',
      '--rm',
      '--name',
      containerName,
      '--network',
      'none',
      '--cpus',
      this.cpuLimit,
      '--memory',
      this.memoryLimit,
      '--pids-limit',
      '256',
      ...(this.noNewPrivileges ? ['--security-opt', 'no-new-privileges'] : []),
      '--cap-drop',
      'ALL',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,exec,size=256m',
      '--user',
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      '--volume',
      `${this.workspacePath}:${CONTAINER_WORKDIR}:rw`,
    ];
    for (const mount of mounts) {
      args.push('--volume', `${path.resolve(mount.hostPath)}:${mount.containerPath}:ro`);
    }
    args.push('--workdir', workdir);
    for (const [key, value] of Object.entries(this.containerEnv(request.env))) {
      args.push('--env', `${key}=${value}`);
    }
    args.push(this.image, request.command, ...request.args);

    return await spawnCaptured({
      command: 'docker',
      args,
      cwd: this.workspacePath,
      env: hostEnvForDockerClient(),
      timeoutMs: request.timeoutMs,
      onTimeout: () => {
        // Best effort: the container outlives a killed client otherwise.
        void spawnCaptured({
          command: 'docker',
          args: ['rm', '--force', containerName],
          cwd: this.workspacePath,
          env: hostEnvForDockerClient(),
          timeoutMs: 15_000,
        });
      },
    });
  }

  /** No API keys, no host secrets. Only what a Node toolchain needs to run. */
  private containerEnv(extra: Readonly<Record<string, string>> | undefined): Record<string, string> {
    return {
      HOME: '/tmp',
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      NPM_CONFIG_CACHE: '/tmp/.npm',
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      NPM_CONFIG_FUND: 'false',
      NPM_CONFIG_AUDIT: 'false',
      CI: '1',
      ...extra,
    };
  }
}

/** The docker client itself needs PATH and its socket setting, nothing else. */
function hostEnvForDockerClient(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env['HOME'] ?? '/tmp',
  };
  const dockerHost = process.env['DOCKER_HOST'];
  if (dockerHost !== undefined) {
    env['DOCKER_HOST'] = dockerHost;
  }
  const dockerContext = process.env['DOCKER_CONTEXT'];
  if (dockerContext !== undefined) {
    env['DOCKER_CONTEXT'] = dockerContext;
  }
  return env;
}

const noNewPrivilegesByImage = new Map<string, boolean>();

/**
 * Some hosts reject `--security-opt no-new-privileges` outright: the container
 * fails to exec anything at all. Rather than assume the flag took effect, or
 * drop it quietly, this probes once per image and the answer is written into
 * every result.json under sandbox.noNewPrivileges.
 */
export async function probeNoNewPrivileges(image: string): Promise<boolean> {
  const cached = noNewPrivilegesByImage.get(image);
  if (cached !== undefined) {
    return cached;
  }
  const outcome = await spawnCaptured({
    command: 'docker',
    args: [
      'run',
      '--rm',
      '--network',
      'none',
      '--security-opt',
      'no-new-privileges',
      '--cap-drop',
      'ALL',
      '--user',
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      image,
      'node',
      '--version',
    ],
    cwd: process.cwd(),
    env: hostEnvForDockerClient(),
    timeoutMs: 60_000,
  });
  const supported = outcome.kind === 'exited' && outcome.exitCode === 0;
  noNewPrivilegesByImage.set(image, supported);
  return supported;
}

export interface DockerAvailability {
  readonly available: boolean;
  readonly imagePresent: boolean;
  readonly detail: string;
}

export async function checkDocker(image: string): Promise<DockerAvailability> {
  const version = await spawnCaptured({
    command: 'docker',
    args: ['version', '--format', '{{.Server.Version}}'],
    cwd: process.cwd(),
    env: hostEnvForDockerClient(),
    timeoutMs: 20_000,
  });
  if (version.kind !== 'exited' || version.exitCode !== 0) {
    return {
      available: false,
      imagePresent: false,
      detail:
        version.kind === 'exited'
          ? version.stderr.trim() || 'docker version failed'
          : `docker client ${version.kind}`,
    };
  }
  const inspect = await spawnCaptured({
    command: 'docker',
    args: ['image', 'inspect', image],
    cwd: process.cwd(),
    env: hostEnvForDockerClient(),
    timeoutMs: 20_000,
  });
  const imagePresent = inspect.kind === 'exited' && inspect.exitCode === 0;
  return {
    available: true,
    imagePresent,
    detail: imagePresent
      ? `docker ${version.stdout.trim()} with image ${image}`
      : `docker ${version.stdout.trim()} but image ${image} is missing`,
  };
}
