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

Without `ELEVENLABS_API_KEY`, the video renders silent with the script burned in as captions, and each section runs for exactly as long as the script's own heading says (`## 0:00 to 0:32, …`). Total runtime is 4:56 against a five minute limit.

With the key set, `pipeline/narrate.mjs` synthesises one file per section and the **audio duration becomes the section duration**, so the visuals follow the voice rather than the other way round. Captions turn themselves off. `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL_ID` override the defaults.

```bash
ELEVENLABS_API_KEY=... npm run video
```

A human recording is the better option if there is time for one: drop one mp3 per section into `narration/` named `01.mp3` … `08.mp3`, run `narrate.mjs` with the key set (it skips synthesis when the file already exists), and the rest of the pipeline treats them the same way.

## The pieces

| Path | What it is |
| --- | --- |
| `record/lib/rec.sh` | The typing helper and the run wrappers every scene shares |
| `record/0*.sh` | One scene each. These are the only files that run project commands |
| `pipeline/trim.mjs` | Deletes idle stretches, records what it deleted in the cast header |
| `pipeline/evidence.mjs` | Derives every figure through the project's own scoring code |
| `pipeline/narrate.mjs` | Script to spoken segments, optionally to audio |
| `pipeline/build.mjs` | The edit: which visual, on which sentence, boxing which phrase |
| `pipeline/appearances.mjs` | Says when a phrase first appears in a recording. A cutting aid |
| `remotion/lib/vt.ts` | A deterministic terminal emulator, so frame N depends only on the recording and N |
| `remotion/components/Terminal.tsx` | The window, the replay, and the highlight boxes |
| `remotion/components/Panels.tsx` | The five data slides |

## Two checks the build will not let you past

**A highlight has to be real.** `build.mjs` looks up every boxed phrase in the recording it names and fails the build if it is not there, or if the edit asks for it before the command printed it. There is no path to a box drawn around text the terminal never showed.

**The runtime has to fit.** `build.mjs` exits non-zero if the assembled timeline runs past five minutes.
