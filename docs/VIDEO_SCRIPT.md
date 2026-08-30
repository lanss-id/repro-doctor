# Video script

Four and a half minutes against a five minute limit. One terminal, one browser tab, no slides. Everything on screen is a real command with real output, and every number is said with its interval.

The brief asks for six things: the problem and the simple baseline, one realistic execution end to end, the final comparison, the changelog, the change that contributed most, and one discarded experiment. They are the six sections below, in that order.

Record at 1920x1080, terminal font large enough to read at half size. Build the Docker image beforehand so nothing waits on a pull.

This script is also the input to [../video/](../video), which builds the recording rather than films it: the section headings below set the timing, the blockquotes are the narration, and the `On screen` lines are what has to be up while each one is said. Editing a heading or a blockquote changes the video. See [../video/README.md](../video/README.md) for what in it is synthetic.

**The hard part of this recording is tonal.** The headline is a result that did not go my way. Say it plainly and early, without apology and without burying it, then let what came out of it do the work. A viewer who senses the null result being managed will stop trusting the rest of the video, which would be the correct response.

Spoken word count is 755, which is four minutes thirty-five at a normal pace, and each section below is timed to its own word count. That leaves about twenty seconds of pause across eight sections. It does not fit a five minute limit with anything added to it.

---

## 0:00 to 0:32, the problem and the baseline

**On screen:** the terminal running `npm run check` in `fixtures/broken-test-discovery/repo`. It exits zero. Scroll up two lines to `tests 0`.

> This repository's check passes. It also runs zero tests, because the glob says dot test dot mjs and the files are named dot spec dot mjs. The exit code says everything is fine.
>
> Hand that to a repair agent and it reports success. The transcript looks perfect.
>
> That is the baseline, and it is not a straw man. Same model, same four tools, same budget as everything below. The only thing it lacks is any way to find out whether it was right.

## 0:32 to 0:58, the idea

**On screen:** the fixture tree, `repo/` beside `oracle/` and `reference/`.

> Only `repo` is copied into the sandbox. The oracle sits beside it and the agent never sees it. It runs afterwards, in a different container, read-only, against a fresh copy of the repaired tree, and it does not ask for an exit code. It counts how many tests actually ran.
>
> An agent that can see the test can make the test pass. This is the cheapest way to stop that.

## 0:58 to 1:45, one execution, end to end

**On screen:** `diagnose fixtures/entrypoint-mismatch/repo --mode advanced`, live. Then the patch, then `result.json`, then `apply` being refused.

> The repository is copied and checksummed first. Everything after runs with no network, no capabilities, a read-only root, and the workspace copy as its only mount.
>
> One file changed. `main` pointed at `dist/main.js`; the build emits `dist/index.js`.
>
> Then the part that counts. The oracle imported the package through whatever entry point the manifest now declares, called the function, checked the string. Exit zero.
>
> These two checksums are the repository before and after. They match, so nothing was written to your code. And applying prints the whole diff and waits. Type anything but `apply` and nothing happens.

## 1:45 to 2:28, the comparison, which did not go my way

**On screen:** the difference chart, interval crossing zero.

> A hundred and forty runs. Ten broken repositories, both modes, seven repeats. Baseline verified forty-two of seventy, advanced fifty-one of seventy. A difference of twelve point nine points, ninety-five per cent interval minus two point eight to plus twenty-seven point six.
>
> **It includes zero.** I wrote the sample size and the rule down before the batch and pushed them first, and by that rule this is a null result. Seventy runs per mode do not establish that the structure is what produced the gap.
>
> That is not a finding that they are the same. What I cannot tell you is that the improvement is real.

## 2:28 to 3:05, the changelog, and the number worth more than the result

**On screen:** the changelog stage table, then the three-row variance chart.

> Seven iterations, each with the run that caused it. An agent that went blind to its budget and had a correct patch refused on call thirteen. A file reader that showed it four per cent of the file the fault was in.
>
> Then this. The baseline arm has not changed by a character across three batches. Fifty-three point three per cent, then forty-six point seven, then sixty. A spread of thirteen point three points, at temperature zero, from nothing.
>
> The effect I was measuring is twelve point nine. **The noise is bigger than the signal.**

## 3:05 to 4:00, the change that contributed most

**On screen:** the ablation table.

> So I removed one ingredient and measured what broke. The bounded retry: when the harness's own check or the hidden oracle rejects the first patch, the agent gets one more turn, with the evidence attached.
>
> Without it, advanced goes from thirteen of thirty-five to **one of thirty-five**. Thirty-four point three points, plus sixteen to plus fifty-one. Clear of zero.
>
> But the mechanism was not what I predicted. Eighteen of those runs had a patch refused for running out of tool calls. The reserved call was also making the agent patch earlier. Two jobs, and I knew about one.
>
> So I ran it again, holding the reservation still and removing only the turn. Twenty-five point seven points, plus three to plus forty-five. Still clear of zero. The second attempt earns its place on its own, and it exists only because something outside the agent said the first one was wrong.

## 4:00 to 4:38, an experiment I threw away, and one I nearly published

**On screen:** the critic table, then the hard-stratum rows.

> A critic that reviews the patch before the retry decision. I wrote the keep rule before running it. It scored one of nine against four of nine, twice, and the rule discarded it.
>
> And one I nearly got wrong. In the first batch, five repositories looked like the whole story: baseline zero out of fifteen, advanced six, a forty point gap clear of zero. I found that after seeing the results, so I froze those cases and made it the next batch's hypothesis instead of publishing it.
>
> In that batch baseline scored eleven out of thirty-five on the same five cases. The forty points was noise.

## 4:38 to 4:56, close

**On screen:** `npm run doctor -- replay submission/evidence/confirmatory` running to completion.

> Every run behind every number I just said is committed. This puts all of them back through the same scoring code, recomputes every check, and reports anything that comes out differently. No key, no model, no network. Ten seconds, nothing.
>
> You do not have to believe me. That was the point.

---

## Notes for recording

- Trim the wait during `diagnose`. Cut, do not speed up: sped-up terminal output looks like a trick.
- Say every interval out loud. This script is built so a viewer never hears a point estimate alone.
- Do not soften the null result with a "but". What follows it is stronger than the result would have been, and it only lands if the null is stated flat.
- Resist the urge to add music.
