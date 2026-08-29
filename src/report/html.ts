const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ESCAPES[character] ?? character);
}

export const REPORT_STYLES = `
:root { color-scheme: light dark; --fg: #16181d; --muted: #5c6370; --line: #d9dce3; --bg: #ffffff; --panel: #f6f7f9; --pass: #14804a; --fail: #b3261e; --warn: #8a6100; }
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6e8ec; --muted: #9aa1ad; --line: #333842; --bg: #14161a; --panel: #1c1f25; --pass: #4ac47f; --fail: #ff8a80; --warn: #e0b054; }
}
* { box-sizing: border-box; }
body { margin: 0 auto; padding: 2rem 1.25rem 4rem; max-width: 68rem; background: var(--bg); color: var(--fg);
  font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.15rem; margin: 2.25rem 0 .6rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); }
h3 { font-size: 1rem; margin: 1.5rem 0 .4rem; }
p { margin: .5rem 0; }
.subtitle { color: var(--muted); margin: 0 0 1.5rem; }
table { border-collapse: collapse; width: 100%; font-size: .92rem; margin: .5rem 0 1rem; }
th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
code, pre { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: .85rem; }
pre { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: .8rem; overflow-x: auto; }
.cards { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1rem 0; }
.card { flex: 1 1 11rem; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: .8rem .9rem; }
.card .label { color: var(--muted); font-size: .78rem; text-transform: uppercase; letter-spacing: .03em; }
.card .value { font-size: 1.45rem; font-variant-numeric: tabular-nums; margin-top: .2rem; }
.pass { color: var(--pass); font-weight: 600; }
.fail { color: var(--fail); font-weight: 600; }
.warn { color: var(--warn); font-weight: 600; }
.muted { color: var(--muted); }
.notice { background: var(--panel); border-left: 3px solid var(--warn); padding: .75rem .9rem; border-radius: 0 6px 6px 0; margin: 1rem 0; }
footer { margin-top: 3rem; color: var(--muted); font-size: .82rem; border-top: 1px solid var(--line); padding-top: .8rem; }
`;

export function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${REPORT_STYLES}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function statusClass(ok: boolean | null): string {
  if (ok === null) return 'muted';
  return ok ? 'pass' : 'fail';
}
