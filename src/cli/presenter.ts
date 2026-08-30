import { redactText } from '../infra/redact.js';

/**
 * The single place allowed to write to stdout. Keeping it here means the rest
 * of the code has no stray console calls, and every user-facing line passes
 * through redaction on its way out.
 */
export interface Presenter {
  line(text?: string): void;
  heading(text: string): void;
  keyValue(key: string, value: string): void;
  bullet(text: string): void;
  block(text: string): void;
}

export function createPresenter(write: (text: string) => void = (text) => process.stdout.write(text)): Presenter {
  const out = (text: string): void => write(`${redactText(text)}\n`);
  return {
    line: (text = '') => out(text),
    heading: (text) => {
      out('');
      out(text);
      out('-'.repeat(Math.min(text.length, 72)));
    },
    // A label longer than the column still gets one space, so a long key
    // never runs into its own value.
    keyValue: (key, value) => out(`  ${key.length >= 28 ? `${key} ` : key.padEnd(28)}${value}`),
    bullet: (text) => out(`  - ${text}`),
    block: (text) => out(text),
  };
}

export const HELP_TEXT = `Repro Doctor: repair an unfamiliar TypeScript repository in a sandbox, then verify it independently.

Usage:
  repro-doctor diagnose <repo> --mode baseline|advanced [options]
  repro-doctor apply <run-id> --to <repo> [--yes-i-reviewed-the-patch]
  repro-doctor eval [--repeats 3] [--case <id>] [--mode <mode>]
  repro-doctor eval --experiment critic|ablation [--repeats 3]
  repro-doctor report
  repro-doctor replay <evidence-bundle>
  repro-doctor fixtures list|verify|patches [--case <id>]

Through npm, put the arguments after a double dash:
  npm run doctor -- diagnose fixtures/entrypoint-mismatch/repo --mode advanced

diagnose options:
  --mode <baseline|advanced>   Required. Both modes share model, tools and budget.
  --case-id <id>               Fixture id, for reporting. Inferred for repositories under fixtures/.
  --oracle-dir <path>          Hidden oracle directory. Inferred for fixtures.
  --oracle-entry <file>        Oracle entry file inside that directory. Default: oracle.mjs.
  --executor <docker|local-test-adapter>
                               Default: docker. The local adapter is for tests only and
                               additionally requires REPRO_DOCTOR_ALLOW_LOCAL_ADAPTER=1.
  --max-tool-calls <n>         Default 12.
  --max-patch-attempts <n>     Default 2.
  --max-seconds <n>            Default 360.
  --max-cost-usd <n>           Default 0.30.
  --command-timeout <n>        Per-command timeout in seconds. Default 60.

eval options:
  --repeats <n>                Repeats per case per mode. Default 3.
  --case <id>                  Restrict to one fixture.
  --mode <baseline|advanced>   Restrict to one mode.
  --experiment <name>          Run a two-arm experiment instead of the mode comparison.
                               Ignores --case and --mode, and writes its own report file so it
                               cannot overwrite the comparison it is measured against.
                                 critic    advanced against advanced with a critic, on the three
                                           hardest fixtures. Kept only for at least +10 points of
                                           verified repair rate at no more than +25 percent
                                           median cost.
                                 ablation  advanced against advanced without the bounded retry,
                                           on the five hard-stratum fixtures. The retry is called
                                           load-bearing only if the 95 percent interval on the
                                           difference excludes zero.
                               A live scored batch refuses to start unless the pinned model has
                               a token price, because an unpriced run cannot enforce a cost budget.
  --max-tool-calls <n>         Raise the tool-call ceiling for both modes at once. Default 12.
                               Used by the budget-sensitivity experiment to ask whether the
                               advantage is capability or only efficiency under scarcity.

replay:
  Recomputes a published evaluation from the run artifacts committed beside it.
  No API key, no model call, no network and no sandbox: the same scoring code
  runs again over the same result.json and trajectory.jsonl files, and any
  verdict that comes out differently is reported rather than overwritten.
  Exits non-zero on a single disagreement.

apply options:
  --to <repo>                  Required. The repository to patch.
  --yes-i-reviewed-the-patch   Explicit approval for non-interactive use. It means a human
                               has read the printed patch. There is no other way to skip the prompt.

Environment:
  OPENAI_API_KEY               Required by diagnose and eval.
  REPRO_DOCTOR_MODEL           Model to pin. Default gpt-4.1-mini.
  REPRO_DOCTOR_RUNNER_IMAGE    Sandbox image. Default repro-doctor-runner:1.

Exit codes: 0 success, 1 the command failed, 2 the command was used incorrectly.
`;
