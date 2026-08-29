import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CheckResult } from '../domain/eval.js';
import type { FixtureLayout } from '../domain/fixture.js';
import { isWithinBudget } from '../domain/budget.js';
import type { RunResult } from '../domain/result.js';

/**
 * Gate checks applied to every scored run. A run only counts as a verified
 * repair when all of them pass, so a "fix" that cheated on isolation, mutated
 * the source, or overran its budget cannot inflate the score.
 */
export async function evaluateRun(
  result: RunResult,
  fixture: FixtureLayout | null,
): Promise<CheckResult[]> {
  return [
    await oracleAccessCheck(result, fixture),
    sourceImmutabilityCheck(result),
    budgetComplianceCheck(result),
    verificationExitStatusCheck(result),
    semanticOracleCheck(result),
    productionSandboxCheck(result),
    costAccountingCheck(result),
  ];
}

export function allPassed(checks: readonly CheckResult[]): boolean {
  return checks.every((check) => check.passed);
}

/**
 * Looks for any sign the agent saw the answer key: a mention of the hidden
 * directories in the trajectory, or those directories appearing in the copied
 * workspace.
 */
export async function oracleAccessCheck(
  result: RunResult,
  fixture: FixtureLayout | null,
): Promise<CheckResult> {
  if (fixture === null) {
    return { name: 'oracle-access', passed: true, detail: 'no fixture registered, nothing to hide' };
  }
  const trajectory = await readFile(result.artifacts.trajectoryPath, 'utf8').catch(() => '');
  const forbidden = [
    path.resolve(fixture.oracleDir),
    path.resolve(fixture.referenceDir),
    path.resolve(fixture.metaPath),
  ];
  const leaked = forbidden.filter((entry) => trajectory.includes(entry));
  if (leaked.length > 0) {
    return {
      name: 'oracle-access',
      passed: false,
      detail: `trajectory references hidden paths: ${leaked.join(', ')}`,
    };
  }
  const workspaceMentions = ['/oracle/', '/reference/', 'meta.json'].filter((needle) =>
    trajectory.includes(`"${result.repo.workspacePath}${needle}"`),
  );
  if (workspaceMentions.length > 0) {
    return {
      name: 'oracle-access',
      passed: false,
      detail: `workspace contained hidden fixture material: ${workspaceMentions.join(', ')}`,
    };
  }
  return { name: 'oracle-access', passed: true, detail: 'no hidden fixture path appears in the trajectory' };
}

export function sourceImmutabilityCheck(result: RunResult): CheckResult {
  return {
    name: 'source-immutability',
    passed: !result.repo.mutated,
    detail: result.repo.mutated
      ? `input tree checksum changed: ${result.repo.treeChecksumBefore} -> ${result.repo.treeChecksumAfter}`
      : `input tree unchanged (${result.repo.treeChecksumBefore})`,
  };
}

export function budgetComplianceCheck(result: RunResult): CheckResult {
  const within = isWithinBudget(result.usage, result.budget);
  return {
    name: 'budget-compliance',
    passed: within,
    detail: within
      ? `${result.usage.toolCalls}/${result.budget.maxToolCalls} tool calls, ${result.usage.patchAttempts}/${result.budget.maxPatchAttempts} patch attempts, ${Math.round(result.usage.wallClockMs / 1000)}s/${result.budget.maxWallClockSeconds}s`
      : 'the run exceeded at least one budget limit',
  };
}

export function verificationExitStatusCheck(result: RunResult): CheckResult {
  const verification = result.verification;
  if (verification.kind === 'passed') {
    return { name: 'verification-exit-status', passed: true, detail: 'oracle exited 0' };
  }
  if (verification.kind === 'failed') {
    return {
      name: 'verification-exit-status',
      passed: true,
      detail: `oracle exited ${verification.exitCode}, which is a valid negative result`,
    };
  }
  return {
    name: 'verification-exit-status',
    passed: false,
    detail: `verification produced no exit status: ${verification.kind}`,
  };
}

export function semanticOracleCheck(result: RunResult): CheckResult {
  return {
    name: 'semantic-oracle',
    passed: result.verification.kind === 'passed',
    detail:
      result.verification.kind === 'passed'
        ? `oracle passed ${result.verification.checks.length} checks`
        : `oracle did not pass: ${result.verification.kind}`,
  };
}

export function isScriptedModel(model: string): boolean {
  return model.startsWith('scripted');
}

export function productionSandboxCheck(result: RunResult): CheckResult {
  const passed = result.sandbox.productionSafe && !isScriptedModel(result.model);
  return {
    name: 'production-sandbox',
    passed,
    detail: passed
      ? `docker sandbox, image ${result.sandbox.image ?? 'unknown'}`
      : `not a submittable run: executor=${result.sandbox.executor} model=${result.model}`,
  };
}

/**
 * A live run whose cost is unknown fails closed. Without a token price the cost
 * budget was never enforced, so the run cannot honestly be counted as a
 * verified repair inside a budget. Scripted runs are exempt: they call no model
 * and spend nothing, and the production-sandbox check already excludes them.
 */
export function costAccountingCheck(result: RunResult): CheckResult {
  if (isScriptedModel(result.model)) {
    return {
      name: 'cost-accounting',
      passed: true,
      detail: 'scripted run, no model call and nothing to price',
    };
  }
  if (result.usage.cost.kind === 'measured') {
    return {
      name: 'cost-accounting',
      passed: true,
      detail: `measured $${result.usage.cost.usd.toFixed(6)} against a limit of $${result.budget.maxCostUsd}`,
    };
  }
  return {
    name: 'cost-accounting',
    passed: false,
    detail: `cost is unknown (${result.usage.cost.why}), so the cost budget was not enforced for ${result.model}`,
  };
}
