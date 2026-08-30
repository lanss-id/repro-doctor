# The submission video, built rather than filmed

`npm run video` produces `out/submission.mp4` from [docs/VIDEO_SCRIPT.md](../docs/VIDEO_SCRIPT.md), six recorded terminal sessions, and the committed evaluation artifacts. Nothing in it is a screenshot, a mock-up, or a number someone typed into a slide.

The reason for building it this way rather than screen-recording it is the same reason the tool has a hidden oracle. A video is a claim about what happened, and a viewer cannot check it. So the pipeline is arranged so that the claim and the evidence cannot come apart: **the terminal shows the bytes a real command wrote, and every figure on screen is computed from a committed artifact by the project's own scoring code.** Re-run the evaluation with a different result and the video says something different without anyone editing a component.

## What is real, and what is not

| | |
| --- | --- |
| Commands, their stdout, their exit status | Real. Recorded as an asciicast from a pty. |
| `result.json`, the patch, the checksums, the oracle's verdict | Real. From `artifacts/runs/<id>/`, produced by an actual `diagnose` run against a real model in a real container. |
| Every rate, difference and interval | Real. Computed by `dist/src/eval/scoring.js` from `submission/evidence/*/eval.json`. |
| Keystroke timing at the prompt | **Synthetic.** `type_cmd` emits the command one character at a time so the recording has a human-paced prompt. The command that then runs is the command that was typed. |
| The voice | **Synthetic.** Generated speech, not a person. The words are the script's, verbatim; see below. |
| Long waits | **Cut, never sped up.** Idle stretches over 2.5s are deleted whole and the window's title bar says how many seconds went. No event is rescaled. |
| Which visual is on screen during which sentence | An editing decision, in `pipeline/build.mjs`. |

The one number not recomputed from a bundle is the development batch's baseline rate, which predates the labelled evidence directory. It is parsed out of the table in `docs/EVALUATION.md` rather than typed in, and carries `source: "docs/EVALUATION.md"` in `evidence/evidence.json`.

## The pipeline

```
docs/VIDEO_SCRIPT.md ──> pipeline/narrate.mjs ──> narration/manifest.json   (what is said, and for how long)
submission/evidence/ ──> pipeline/evidence.mjs ─> evidence/evidence.json    (every figure on screen)
record/*.sh ─ asciinema ─> recordings/*.cast ──> pipeline/trim.mjs          (what the terminal shows)
                                          |
                                          v
                              pipeline/build.mjs ──> timeline.json
                                          |
                                          v
                                  remotion render ──> out/submission.mp4
```

Run it end to end:

```bash
cd video
npm install
npm run video
```

`npm run video` re-derives the evidence, re-reads the script, rebuilds the timeline and renders. It does **not** re-record the terminal sessions, because those cost a live model run; see below.

## Re-recording the terminal

```bash
export PATH="$HOME/.local/bin:$PATH"     # asciinema
./record/record-all.sh 01-baseline 02-idea 08-replay
```

Those three need no API key. The repair scene does:

```bash
set -a; . ../.env; set +a
./record/record-diagnose.sh                       # live model run, in Docker
RUN_ID=$(cat recordings/03a-run-id.txt) ./record/record-all.sh 03b-evidence 03c-apply
node pipeline/trim.mjs 01-baseline 02-idea 03a-diagnose 03b-evidence 03c-apply 08-replay
```

`record-diagnose.sh` keeps the first run whose hidden oracle exited zero, and writes **every** attempt to `recordings/03a-attempts.json` with its run id and outcome. A single run is one draw from the distribution this project spends its whole evaluation measuring, so selecting one is fine as long as the selection is on the record. The run in the video took two attempts: the first produced a patch the oracle rejected, on a case that scored 7/7 for advanced mode in the confirmatory batch. That is the variance section's point, arriving early.

## Narration

A section's voice track is `public/narration/<id>.mp3`. Where one exists, **its duration becomes the section's duration**, so the visuals follow the voice rather than the other way round, and captions turn themselves off. What produced the file does not matter: a person at a microphone, ElevenLabs through `pipeline/narrate.mjs`, or anything else writing into that directory. With no files at all, each section runs for exactly as long as the script's own heading says and the video renders silent with the script burned in as captions — a complete video missing only a voice.

The track that ships was generated with Higgsfield's `seed_audio`, preset voice *Arthur*. It is a synthetic voice reading the script verbatim, and `narration/takes.json` records how it was made.

**Two takes per section.** Take *a* ran at the model's default speed and came in at 327.9s against the 296s the script budgets — pacing varied from 118 to 177 words per minute across sections with no rate set. Take *b* re-ran each section at a `speech_rate` derived from how far take *a* had overrun its own heading. The kept take is whichever landed closer to the script's timing; both are archived under `narration/takes/` so the choice can be checked rather than taken. Four of each were kept, for 4:55.1 total.

The rate is not linear and the model does not repeat itself: section 01 ran 32.5s at rate 0 and 48.4s at rate +3. Two takes were enough here; a third pass would be a slot machine, not a fix.

To re-do the voice with ElevenLabs instead:

```bash
rm public/narration/*.mp3
ELEVENLABS_API_KEY=... npm run video
```

`ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID` override the defaults. A human recording is better than either if there is time for one — the script's own note is that the hard part is tonal, and a null result has to sound flat rather than managed. Drop `01.mp3` … `08.mp3` into `public/narration/` and the rest of the pipeline treats them identically.

## The pieces

| Path | What it is |
| --- | --- |
| `record/lib/rec.sh` | The typing helper and the run wrappers every scene shares |
| `record/0*.sh` | One scene each. These are the only files that run project commands |
| `pipeline/trim.mjs` | Deletes idle stretches, records what it deleted in the cast header |
| `pipeline/evidence.mjs` | Derives every figure through the project's own scoring code |
| `pipeline/narrate.mjs` | Script to spoken segments, and to their durations once a voice track exists |
| `pipeline/build.mjs` | The edit: which visual, on which sentence, boxing which phrase |
| `pipeline/appearances.mjs` | Says when a phrase first appears in a recording. A cutting aid |
| `remotion/lib/vt.ts` | A deterministic terminal emulator, so frame N depends only on the recording and N |
| `remotion/components/Terminal.tsx` | The window, the replay, and the highlight boxes |
| `remotion/components/Panels.tsx` | The data panels |
| `public/narration/` | The voice track Remotion reads through `staticFile` |
| `narration/takes.json` | Every take generated, its speed, its length, and which one was kept |

## Two checks the build will not let you past

**A highlight has to be real.** `build.mjs` looks up every boxed phrase in the recording it names and fails the build if it is not there, or if the edit asks for it before the command printed it. There is no path to a box drawn around text the terminal never showed.

**The runtime has to fit.** `build.mjs` exits non-zero if the assembled timeline runs past five minutes.
