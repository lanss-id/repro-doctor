#!/usr/bin/env node
/**
 * Turns docs/VIDEO_SCRIPT.md into the narration track and the timing the video
 * is cut against.
 *
 * The script is the source of truth for both. Each `## 0:00 to 0:32, title`
 * heading gives a section its place and its length, the blockquote under it is
 * what is said, and the `**On screen:**` line is what has to be showing while
 * it is said. Nothing here paraphrases the script: if a sentence is not in
 * VIDEO_SCRIPT.md it is not in the video.
 *
 * With ELEVENLABS_API_KEY set, each section is synthesised and its real audio
 * duration becomes the section's duration, so the visuals follow the voice
 * rather than the other way round. Without a key the script's own declared
 * timings are used and the video renders silent with captions, which is a
 * complete video missing only a voice.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SCRIPT = path.join(ROOT, 'docs/VIDEO_SCRIPT.md');
const OUT_DIR = path.join(ROOT, 'video/narration');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

/** ElevenLabs defaults. Both are overridable from the environment. */
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? 'JBFqnCBsd6RMkjVDRZzb';
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';

const timestampToSeconds = (value) => {
  const [minutes, seconds] = value.split(':').map(Number);
  return minutes * 60 + seconds;
};

/** Splits the script into its timed sections, keeping the spoken text verbatim. */
export function parseScript(markdown) {
  const sections = [];
  let current = null;

  for (const line of markdown.split('\n')) {
    const heading = line.match(/^## (\d+:\d\d) to (\d+:\d\d), (.+)$/);
    if (heading !== null) {
      if (current !== null) {
        sections.push(current);
      }
      current = {
        id: String(sections.length + 1).padStart(2, '0'),
        title: heading[3],
        scriptStart: timestampToSeconds(heading[1]),
        scriptEnd: timestampToSeconds(heading[2]),
        onScreen: null,
        paragraphs: [],
      };
      continue;
    }
    if (current === null) {
      continue;
    }
    if (line.startsWith('## ') || line.startsWith('---')) {
      sections.push(current);
      current = null;
      continue;
    }
    const onScreen = line.match(/^\*\*On screen:\*\*\s*(.+)$/);
    if (onScreen !== null) {
      current.onScreen = onScreen[1];
      continue;
    }
    if (line.startsWith('>')) {
      const text = line.replace(/^>\s?/, '').trim();
      if (text.length > 0) {
        current.paragraphs.push(text);
      }
    }
  }
  if (current !== null) {
    sections.push(current);
  }
  return sections;
}

/** Markdown emphasis is for the reader of the script, not for the voice. */
const spokenText = (paragraphs) =>
  paragraphs
    .join(' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

const durationOf = async (file) => {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Number.parseFloat(stdout.trim());
};

const synthesise = async (text, target, apiKey) => {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.0 },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`ElevenLabs returned ${response.status}: ${await response.text()}`);
  }
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
};

const exists = async (file) => access(file).then(() => true).catch(() => false);

const markdown = await readFile(SCRIPT, 'utf8');
const sections = parseScript(markdown);
if (sections.length === 0) {
  throw new Error(`no timed sections found in ${SCRIPT}`);
}

await mkdir(OUT_DIR, { recursive: true });

const apiKey = process.env.ELEVENLABS_API_KEY ?? null;
const force = process.argv.includes('--force');
const segments = [];
let cursor = 0;

for (const section of sections) {
  const text = spokenText(section.paragraphs);
  const words = text.split(/\s+/).filter(Boolean).length;
  const scriptDuration = section.scriptEnd - section.scriptStart;
  let audio = null;
  let duration = scriptDuration;
  let source = 'script-timings';

  if (apiKey !== null) {
    const file = path.join(OUT_DIR, `${section.id}.mp3`);
    if (force || !(await exists(file))) {
      process.stdout.write(`synthesising ${section.id} (${words} words)\n`);
      await synthesise(text, file, apiKey);
    }
    // A little air after the last word so the next section does not clip in.
    duration = (await durationOf(file)) + 0.6;
    audio = path.relative(ROOT, file);
    source = 'audio';
  }

  segments.push({
    id: section.id,
    title: section.title,
    onScreen: section.onScreen,
    text,
    words,
    audio,
    durationSource: source,
    scriptStart: section.scriptStart,
    scriptEnd: section.scriptEnd,
    scriptDuration,
    start: Number(cursor.toFixed(3)),
    duration: Number(duration.toFixed(3)),
  });
  cursor += duration;
}

const manifest = {
  generatedAt: new Date().toISOString(),
  source: path.relative(ROOT, SCRIPT),
  hasAudio: apiKey !== null,
  voice: apiKey === null ? null : { provider: 'elevenlabs', voiceId: VOICE_ID, modelId: MODEL_ID },
  totalSeconds: Number(cursor.toFixed(3)),
  totalWords: segments.reduce((total, segment) => total + segment.words, 0),
  segments,
};

await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const minutes = Math.floor(manifest.totalSeconds / 60);
const seconds = Math.round(manifest.totalSeconds % 60);
console.log(`wrote ${path.relative(ROOT, MANIFEST)}`);
console.log(`  ${segments.length} sections, ${manifest.totalWords} spoken words`);
console.log(
  `  total ${minutes}:${String(seconds).padStart(2, '0')} from ${manifest.hasAudio ? 'synthesised audio' : "the script's own timings"}`,
);
if (!manifest.hasAudio) {
  console.log('  set ELEVENLABS_API_KEY to replace the estimate with a real voice track');
}
