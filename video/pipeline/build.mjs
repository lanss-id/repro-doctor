#!/usr/bin/env node
/**
 * Assembles the timeline the compositions render.
 *
 * Three inputs, and the split between them is the point. `narration/manifest.json`
 * decides when each section starts and how long it lasts. `evidence/evidence.json`
 * decides what every number on screen says. This file decides only which visual
 * is up during which sentence, which is an editing decision and the one thing
 * here that is allowed to be a matter of taste.
 *
 * Two things are resolved rather than typed. Beats are anchored to sentences,
 * so a beat that starts at sentence four still starts at sentence four when the
 * narration is re-recorded at a different pace. And a highlight names the text
 * it boxes rather than a timestamp: its moment is looked up in the recording,
 * and a phrase that is not in the recording stops the build instead of
 * quietly boxing nothing.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const VIDEO = path.join(ROOT, 'video');

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
/** A highlight lands just after its text finishes printing, not on the same frame. */
const HIGHLIGHT_SETTLE_SECONDS = 0.35;

const readJson = async (relative) => JSON.parse(await readFile(path.join(VIDEO, relative), 'utf8'));
const exists = async (file) => access(file).then(() => true).catch(() => false);

/**
 * The edit. Each section lists its beats in order; `fromSentence` is the index
 * of the spoken sentence the beat comes up on. Terminal beats name a recording
 * and the phrases worth boxing while it is on screen.
 */
const EDIT = {
  '01': [
    {
      kind: 'terminal',
      cast: '01-baseline',
      fromSentence: 0,
      highlights: [
        { text: 'tests/**/*.test.mjs', label: 'the glob', showAt: 3.5, hold: 6 },
        { text: 'tests 0', label: 'nothing ran', showAt: 4.8, hold: 5.5 },
        { text: 'exit status 0', label: 'and the check still passed', showAt: 10.6, hold: 6 },
        { text: 'sum.spec.mjs', label: 'the file on disk', showAt: 17.6, hold: 8 },
      ],
    },
  ],
  '02': [
    {
      kind: 'terminal',
      cast: '02-idea',
      fromSentence: 0,
      highlights: [
        { text: 'oracle  reference  repo', label: 'only repo is copied into the sandbox', showAt: 2.4, hold: 5 },
        { text: 'npm test runs at least two tests', label: 'what the hidden oracle asks', showAt: 8.8, hold: 8 },
        { text: 'if (passed < 2)', label: 'a count, not an exit code', showAt: 17.0, hold: 7 },
      ],
    },
  ],
  '03': [
    {
      kind: 'terminal',
      cast: '03a-diagnose',
      fromSentence: 0,
      highlights: [
        { text: 'hidden oracle', label: 'beside the repository, never in it', showAt: 4.6, hold: 4 },
        { text: 'input repository            unchanged', showAt: 9.4, hold: 3 },
      ],
    },
    {
      kind: 'terminal',
      cast: '03b-evidence',
      fromSentence: 2,
      highlights: [
        { text: '+  "main": "dist/index.js",', label: 'what the build actually emits', showAt: 3.8, hold: 5 },
        { text: '"treeChecksumBefore"', showAt: 20.0, hold: 6 },
        { text: '"treeChecksumAfter"', label: 'identical, so nothing was written', showAt: 20.0, hold: 6 },
        { text: 'PASS greet("world") returns "hello world" through the entry point', label: 'the hidden oracle, exit zero', showAt: 16.4, hold: 3.4 },
      ],
    },
    {
      kind: 'terminal',
      cast: '03c-apply',
      fromSentence: 9,
      highlights: [{ text: 'Cancelled. Nothing was written.', showAt: 4.6 }],
    },
  ],
  '04': [{ kind: 'difference', fromSentence: 0 }],
  '05': [
    { kind: 'changelog', fromSentence: 0 },
    { kind: 'variance', fromSentence: 3 },
  ],
  '06': [
    { kind: 'experiment', experiment: 'ablation', fromSentence: 0 },
    { kind: 'mechanism', fromSentence: 5 },
    { kind: 'experiment', experiment: 'reserve', fromSentence: 9 },
  ],
  '07': [
    { kind: 'experiment', experiment: 'critic', fromSentence: 0 },
    { kind: 'subgroup', fromSentence: 3 },
  ],
  '08': [
    {
      kind: 'terminal',
      cast: '08-replay',
      fromSentence: 0,
      highlights: [
        { text: 'runs re-scored              140/140', showAt: 4.0, hold: 4.5 },
        { text: 'advanced - baseline', label: 'recomputed, not re-read', showAt: 9.4, hold: 4 },
        { text: 'Every re-scored run agrees', showAt: 13.6 },
      ],
    },
  ],
};

/** Sentence boundaries, kept simple: the script is prose, not code. */
const toSentences = (text) =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

const stripAnsi = (text) =>
  text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*\u0007/g, '');

/**
 * When a phrase first finishes printing. The recordings are append-only apart
 * from a spinner, so accumulating the stripped output and watching for the
 * phrase is enough, and it is checked rather than assumed.
 */
const firstAppearance = (events, phrase) => {
  let accumulated = '';
  for (const [time, , data] of events) {
    accumulated += stripAnsi(data);
    if (accumulated.includes(phrase)) {
      return time;
    }
  }
  return null;
};

const narration = await readJson('narration/manifest.json');
const evidence = await readJson('evidence/evidence.json');

const sections = [];
for (const segment of narration.segments) {
  const beats = EDIT[segment.id];
  if (beats === undefined) {
    throw new Error(`section ${segment.id} ("${segment.title}") has no beats in the edit`);
  }

  const sentences = toSentences(segment.text);
  const wordsPerSentence = sentences.map(
    (sentence) => sentence.split(/\s+/).filter(Boolean).length,
  );
  const totalWords = wordsPerSentence.reduce((total, count) => total + count, 0);

  // Where each sentence begins, as a fraction of the section, by word count.
  const sentenceStarts = [];
  let spoken = 0;
  for (const count of wordsPerSentence) {
    sentenceStarts.push((spoken / totalWords) * segment.duration);
    spoken += count;
  }

  const captions = sentences.map((text, index) => ({
    text,
    start: Number(sentenceStarts[index].toFixed(3)),
    duration: Number(
      ((sentenceStarts[index + 1] ?? segment.duration) - sentenceStarts[index]).toFixed(3),
    ),
  }));

  const resolved = [];
  for (const [index, beat] of beats.entries()) {
    const start = sentenceStarts[beat.fromSentence];
    if (start === undefined) {
      throw new Error(
        `section ${segment.id} beat ${index} starts at sentence ${beat.fromSentence}, but the section has ${sentences.length}`,
      );
    }
    const next = beats[index + 1];
    const end =
      next === undefined
        ? segment.duration
        : (sentenceStarts[next.fromSentence] ?? segment.duration);
    // Where each of this beat's own sentences begins, measured from the beat.
    // A panel staged against these stays in step with the narration instead of
    // arriving whole and then sitting still for half a minute.
    const cues = sentenceStarts
      .filter((at) => at >= start - 0.001 && at < end - 0.001)
      .map((at) => Number((at - start).toFixed(3)));

    const resolvedBeat = {
      ...beat,
      start: Number(start.toFixed(3)),
      duration: Number((end - start).toFixed(3)),
      cues,
    };

    if (beat.kind === 'terminal') {
      const file = path.join(VIDEO, 'recordings', `${beat.cast}.trimmed.cast`);
      if (!(await exists(file))) {
        throw new Error(`beat names recording ${beat.cast}, which has not been trimmed yet`);
      }
      const cast = await readFile(file, 'utf8');
      const events = cast
        .split('\n')
        .slice(1)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));

      const header = JSON.parse(cast.split('\n')[0]);
      resolvedBeat.castFile = path.relative(VIDEO, file);
      resolvedBeat.castDuration = events.length === 0 ? 0 : events[events.length - 1][0];
      // Inlined rather than fetched at render time: the compositions stay pure
      // functions of this file, and a render cannot silently use a stale cast.
      resolvedBeat.cast = {
        width: header.width,
        height: header.height,
        cuts: header.cuts ?? [],
        events: events
          .filter(([, kind]) => kind === 'o')
          .map(([time, , data]) => [Number(time.toFixed(3)), data]),
      };
      resolvedBeat.highlights = (beat.highlights ?? []).map((highlight) => {
        const at = firstAppearance(events, highlight.text);
        if (at === null) {
          throw new Error(
            `section ${segment.id}: "${highlight.text}" is not in recording ${beat.cast}`,
          );
        }
        const earliest = at + HIGHLIGHT_SETTLE_SECONDS;
        if (highlight.showAt !== undefined && highlight.showAt < earliest) {
          throw new Error(
            `section ${segment.id}: "${highlight.text}" is asked for at ${highlight.showAt}s but is not printed until ${earliest.toFixed(2)}s`,
          );
        }
        const from = highlight.showAt ?? earliest;
        return {
          text: highlight.text,
          ...(highlight.label === undefined ? {} : { label: highlight.label }),
          from: Number(from.toFixed(3)),
          until: highlight.hold === undefined ? null : Number((from + highlight.hold).toFixed(3)),
        };
      });
    }
    resolved.push(resolvedBeat);
  }

  sections.push({
    id: segment.id,
    title: segment.title,
    onScreen: segment.onScreen,
    start: segment.start,
    duration: segment.duration,
    audio: segment.audio,
    text: segment.text,
    captions,
    beats: resolved,
  });
}

const totalSeconds = narration.totalSeconds;
const timeline = {
  generatedAt: new Date().toISOString(),
  fps: FPS,
  width: WIDTH,
  height: HEIGHT,
  totalSeconds,
  durationInFrames: Math.ceil(totalSeconds * FPS),
  hasAudio: narration.hasAudio,
  showCaptions: !narration.hasAudio,
  limitSeconds: 300,
  sections,
  evidenceGeneratedAt: evidence.generatedAt,
};

await writeFile(path.join(VIDEO, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`, 'utf8');

const minutes = Math.floor(totalSeconds / 60);
const seconds = totalSeconds % 60;
console.log('wrote video/timeline.json');
console.log(`  ${sections.length} sections, ${timeline.durationInFrames} frames at ${FPS}fps`);
console.log(`  runtime ${minutes}:${seconds.toFixed(1).padStart(4, '0')} against a 5:00 limit`);
if (totalSeconds > timeline.limitSeconds) {
  console.error(`  OVER THE LIMIT by ${(totalSeconds - timeline.limitSeconds).toFixed(1)}s`);
  process.exit(1);
}
