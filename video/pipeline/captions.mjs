#!/usr/bin/env node
/**
 * Writes the video's caption track.
 *
 * The cues come from the same `timeline.json` the compositions render, so a
 * caption cannot say something the narration does not, and re-timing the voice
 * re-times the captions with it. One cue per spoken sentence, which is how the
 * timeline already divides the script.
 *
 * It lands in `site/` because that is what GitHub Pages publishes and what the
 * `<track>` element on the landing page loads.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'site/submission.vtt');

/** WebVTT wants hh:mm:ss.mmm. */
const stamp = (seconds) => {
  const whole = Math.floor(seconds);
  const ms = Math.round((seconds - whole) * 1000);
  const hh = String(Math.floor(whole / 3600)).padStart(2, '0');
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${String(ms).padStart(3, '0')}`;
};

const timeline = JSON.parse(await readFile(path.join(ROOT, 'video/timeline.json'), 'utf8'));

const cues = [];
for (const section of timeline.sections) {
  for (const caption of section.captions) {
    const start = section.start + caption.start;
    cues.push({
      start,
      // Never run a cue past the section that owns it.
      end: Math.min(start + caption.duration, section.start + section.duration),
      text: caption.text,
    });
  }
}

const body = cues
  .map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`)
  .join('\n');

await writeFile(OUT, `WEBVTT\n\n${body}`, 'utf8');
console.log(`wrote ${path.relative(ROOT, OUT)}`);
console.log(`  ${cues.length} cues across ${timeline.sections.length} sections`);
