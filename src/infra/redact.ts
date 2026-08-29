/**
 * Secret scrubbing for anything that leaves the process: trajectories, logs,
 * reports and tool output shown to the model. The rule is one-way. Redaction
 * happens on the write path so an artifact can never contain a live key, even
 * if a repository under repair prints its own environment.
 */

interface RedactionRule {
  readonly label: string;
  readonly pattern: RegExp;
  /** Index of the capture group to keep in place of the whole match. */
  readonly keepGroup?: number;
}

const RULES: readonly RedactionRule[] = [
  { label: 'pem-private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu },
  { label: 'openai-key', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{16,}/gu },
  { label: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/gu },
  { label: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/gu },
  { label: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{30,}/gu },
  { label: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/gu },
  { label: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{30,}/gu },
  { label: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu },
  { label: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/gu },
  { label: 'bearer-token', pattern: /\b(Bearer|Token)\s+[A-Za-z0-9._~+/=-]{12,}/giu, keepGroup: 1 },
  {
    label: 'authorization-header',
    pattern: /\b(authorization|proxy-authorization|x-api-key|api-key)\b(\s*[:=]\s*)(["']?)[^\s"',;]{6,}\3/giu,
    keepGroup: 1,
  },
  {
    label: 'secret-assignment',
    pattern:
      /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_]*)(\s*[:=]\s*)(["']?)([^\s"',;]{4,})\3/giu,
    keepGroup: 1,
  },
];

export function redactText(input: string): string {
  let output = input;
  for (const rule of RULES) {
    output = output.replace(rule.pattern, (_match: string, ...groups: unknown[]) => {
      if (rule.keepGroup === undefined) {
        return `[redacted:${rule.label}]`;
      }
      const kept: unknown = groups[rule.keepGroup - 1];
      const prefix = typeof kept === 'string' ? kept : '';
      const separator = rule.label === 'bearer-token' ? ' ' : '=';
      return `${prefix}${separator}[redacted:${rule.label}]`;
    });
  }
  return output;
}

const SECRET_KEY_PATTERN = /(secret|token|password|passwd|api[-_]?key|credential|authorization)/iu;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function redactJson(value: JsonValue): JsonValue {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactJson);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? '[redacted:key-name]' : redactJson(entry);
    }
    return out;
  }
  return value;
}

/**
 * True when the text still contains something that looks like a live secret.
 * Placeholders left behind by {@link redactText} are removed first, so an
 * already-redacted line does not report itself as a leak.
 */
export function containsSecret(text: string): boolean {
  const withoutPlaceholders = text.replace(/\[redacted:[a-z-]+\]/gu, '');
  return RULES.some((rule) => {
    const probe = new RegExp(rule.pattern.source, rule.pattern.flags.replace('g', ''));
    return probe.test(withoutPlaceholders);
  });
}
