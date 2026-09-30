# DAC’S Three-Video Remotion Production — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver three separately playable, animated 1080p videos with Taglish narration, sound effects, burned-in captions, SRT files and editable Remotion source.

**Architecture:** One isolated Remotion project shares device frames, motion, audio timing and captions across three compositions. Forty-four individually authored scenes use synthetic data and the approved storyboard. Audio is generated and cached before rendering; each scene's duration is derived from its actual narration and required screen-reading time.

**Tech Stack:** Node.js 24, React, TypeScript, Remotion and its local renderer; bundled Python 3.12 for speech preparation and original WAV effects. Resolve compatible package versions at installation, pin them in the project lockfile, and use one exact version for every `remotion`/`@remotion/*` package.

**Spec:** [Approved three-part storyboard and complete Taglish scripts](../specs/2026-09-30-workmate-remotion-video-design.md).

**Execution recommendation:** Native: implement in this chat, one task at a time. These deliverables share timing and visual components, so a single implementation pass is simpler than parallel scene authors. The skill's final independent reviewer may review the finished isolated project after implementation; do not delegate implementation unless the user selects that method.

## Global constraints

- Three compositions: `WorkMateWorkers`, `WorkMateBuying`, `DacsWeb`.
- Three standalone 1920 × 1080 MP4s at 30 fps, with an editable Remotion project and separate SRT captions.
- Workers around 2:30; Buying around 2:45; DAC’S Web around 4:35. Final durations follow actual audio; do not truncate speech to match estimates.
- Use the exact approved Taglish script as editorial source. Pronunciation-only substitutions belong in a separate `spokenText` field.
- Workers W01–W12, Buying B01–B12 and Web D01–D20 each need their own visual treatment and staged screen actions.
- Use synthetic people, projects, dates and amounts. Do not capture real customer, employee or financial records.
- Keep WorkMate `PRODUCT PREVIEW · SAMPLE DATA`, later-stage `PLANNED MODULE` and meetings `DESIGN PREVIEW` labels visible as prescribed by the spec.
- Worker/leader views have no procurement amounts or receipt originals. Buyer samples mask peso amounts. Web monetary panels are explicitly owner-mode examples; staff inserts hide amounts.
- No application code, database records, access controls or deployment settings change. Never run the root `npm run build`.
- The only production source directory is `video/workmate-showcase/`. Do not create a root application `src/` or JSX source.
- No production queries, live application imports, remote fonts or runtime speech synthesis during rendering.
- No silent replacement of Taglish narration with English-only speech or a muted final video.
- No CSS-clock animation, random unseeded motion or wall-clock timing in compositions.
- Preserve unrelated pre-existing working changes under `docs/superpowers/`.

## Confirmed environment and dependencies

Node is available at `C:/Program Files/nodejs/node.exe` (v24.13.1). Python is available at `C:/Users/John Aerol Tapales/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe` (3.12.14). Python has pip; `edge_tts` and `mutagen` are not installed. No system ffmpeg was found on PATH. Use the installed Remotion renderer's supported browser/media utilities; do not assume system ffmpeg exists.

There is no dedicated speech-generation tool in the current tool inventory. The first voice route to test is the documented `edge-tts` package with `fil-PH-BlessicaNeural`, a synthetic Filipino voice. This is a proposed external synthesis route, not a verified working connection. Send only the approved synthetic presentation script, never application records. Check current voice availability before generation. If the package/service is unavailable, preserve completed scene work and report the exact audio blocker; do not create a paid account, ask for secrets in chat or change narration language.

Primary references checked during planning:

- [Remotion registration](https://www.remotion.dev/docs/register-root)
- [Remotion local rendering](https://www.remotion.dev/docs/renderer/render-media)
- [Remotion audio](https://www.remotion.dev/docs/html5-audio)
- [Remotion metadata inspection](https://www.remotion.dev/docs/renderer/get-video-metadata)
- [edge-tts maintained usage and subtitle support](https://github.com/rany2/edge-tts)
- [Microsoft voice language listing](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)

## Files and responsibilities

All paths below are relative to `video/workmate-showcase/` unless another root is written explicitly.

| Files | Responsibility |
|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `remotion.config.ts`, `.gitignore` | Isolated dependencies, scripts, type checks, output configuration and source retention |
| `index.ts`, `compositions/Root.tsx` | Entry point and three composition registrations |
| `content/workers.json`, `content/buying.json`, `content/web.json` | Approved script, scene IDs, roles, status, action descriptions and visual keys |
| `content/media-manifest.json` | Actual narration durations and sentence/phrase timing; generated only from complete media |
| `scripts/import-storyboard.mjs` | Parse the approved Markdown tables into the three content files; reject duplicate/missing IDs |
| `scripts/extract-assets.py` | Copy only allowlisted logo/font archive members into `public/brand/` |
| `scripts/narrate.py`, `requirements.txt` | Voice sample, per-scene MP3/subtitles, measured duration and reproducible speech setup |
| `scripts/make-sfx.py` | Original deterministic tap, confirmation and transition WAV files |
| `scripts/timing.mjs`, `scripts/validate.mjs` | Build contiguous timelines, validate local media/captions and fail incomplete exports |
| `compositions/Showcase.tsx`, `compositions/theme.ts`, `compositions/styles.css` | Shared composition layout, fonts, caption placement and deterministic sequencing |
| `compositions/components/Phone.tsx`, `Desktop.tsx`, `Pointer.tsx`, `Captions.tsx`, `SceneHeader.tsx` | Reusable device frames, action markers and typography |
| `compositions/scenes/WorkerScenes.tsx`, `BuyerScenes.tsx`, `WebScenes.tsx` | Audience-specific screen layouts and scene/action rendering |
| `scripts/render.mjs`, `scripts/export-srt.mjs`, `scripts/inspect-output.mjs` | Preview frames, short sample, final renders, captions and metadata checks |
| `tests/content.test.mjs`, `tests/timing.test.mjs` | Meaningful content/timing failure checks |
| `public/brand/`, `public/screens/`, `public/audio/` | Local brand assets, synthetic screen assets, narration and effects |
| `out/`, `review/`, `README.md` | Final deliverables, review frames/verification notes, editing instructions |

The repository ignores most extensions by default, including `.tsx`, `.mjs`, `.py`, `.mp3`, `.wav` and `.srt`, and ignores `package-lock.json`. The project-local `.gitignore` must explicitly include these source/media extensions and its lockfile, and exclude local Python packages, caches, rendered review frames and `out/`. Verify with `git check-ignore`; do not change the application's root ignore policy. Final exports remain local deliverables and are not committed automatically.

## Shared data contract

```ts
type VideoId = 'WorkMateWorkers' | 'WorkMateBuying' | 'DacsWeb';
type SceneRole = 'worker' | 'leader' | 'buyer' | 'owner' | 'staff' | 'client';
type Caption = {startMs: number; endMs: number; text: string};
type Scene = {
  id: string;
  title: string;
  role: SceneRole;
  label: 'PRODUCT PREVIEW · SAMPLE DATA' | 'PLANNED MODULE' |
    'DESIGN PREVIEW' | 'SAMPLE DATA';
  narration: string;
  spokenText: string;
  minimumSeconds: number;
  visualKey: string;
};
type SceneMedia = {
  sceneId: string;
  audioPath: string; // public-relative, e.g. audio/voice/W01.mp3
  audioSeconds: number;
  captions: Caption[]; // relative to the audio, not the composition
};
type TimedScene = {
  scene: Scene;
  media: SceneMedia;
  from: number;
  durationInFrames: number;
  narrationStartFrame: number; // relative to scene
};
```

`createTimeline(scenes, mediaById, fps = 30)` returns `{scenes: TimedScene[], durationInFrames: number}`. `toSrt(timeline, fps = 30)` returns UTF-8 SRT text with global offsets. `validateVideo(scenes, mediaById, publicDir)` throws descriptive errors including the scene ID. Both render and SRT export consume this same timeline; never duplicate duration calculations in the UI.

## Review focus

1. A spoken sentence exceeds its estimated slot: extend the scene and captions without truncating speech. Pin in Task 1 timing tests and Task 5 export checks.
2. A voice request fails or returns an empty/corrupt file: retain other cached audio, reject that scene and block final rendering. Pin in Task 1 validation tests.
3. A scene has long captions, accented punctuation or the same final caption at a cut: preserve UTF-8 and inspect line fitting, timing and visibility. Pin in Task 1 SRT tests and each audience's frame review.
4. A preview/staff scene accidentally inherits an owner amount or an existing-feature label: explicit roles/labels, owner-only financial layouts, and frame review in Tasks 2–4.
5. Font loading or an asset reference fails during headless rendering: wait for local fonts and fail missing files rather than export fallback glyphs or empty panels. Pin in Task 1 validation and Task 5 render diagnostics.

## Task 1 — Working audio, content and timeline pipeline

**Deliverable:** all 44 approved script entries, a tested Taglish voice sample, complete local narration/effects and one validated timeline per video. Voice availability is checked early so it cannot become a hidden end-of-project problem.

- [ ] Create the isolated directory and local ignore file. Pin compatible React/Remotion/TypeScript dependencies and preserve `package-lock.json`. Use `npm install --save-exact` only inside the video directory. Register scripts: `studio`, `check`, `validate`, `test`, `render`, `render:all`, `stills`, `captions`, `inspect`. Do not add a `build` script to the application.
- [ ] Read the approved spec and import its table rows with `^\| ([WBD]\d{2}) / (\d+) \| (.*?) \| (.*?) \|$`. Require W01–W12, B01–B12 and D01–D20 exactly once. Convert estimated seconds to `minimumSeconds` initially; editors may shorten long empty holds after narration review. Preserve narration verbatim, with separate pronunciation text.
- [ ] Extract only `assets/dacs_logo.png`, the four bundled Barlow fonts and the two bundled IBM Plex Mono fonts. Explicitly map each archive member to a destination under `public/brand/`; do not bulk-extract or execute `support.js` from the archive.
- [ ] Install Python speech dependencies in the video project's `.python-packages/`, not globally. Record exact installed versions in `requirements.txt`. Discover current voices, then generate W01 and B05 with `fil-PH-BlessicaNeural`, starting at rate `+0%`. Use structured Python argument arrays for speech commands and file paths; do not construct shell strings from narration.

Example per-scene speech invocation inside `narrate.py` after dependencies are available:

```python
subprocess.run([
    sys.executable, '-m', 'edge_tts',
    '--voice', 'fil-PH-BlessicaNeural',
    '--rate=+0%', '--file', str(text_path),
    '--write-media', str(audio_path),
    '--write-subtitles', str(subtitle_path)
], check=True, timeout=120)
```

- [ ] Preview the two samples. Check DAC’S, WorkMate, Filipino verbs and the English quantity labels. If the agent cannot hear generated audio through available tooling, present the playable sample for the user's pronunciation check; do not claim an unperformed listening test. Continue independent visual work while feedback is pending. Adjust pronunciation text and rate as needed without changing meaning.
- [ ] Generate all scene clips with resumable caching keyed by voice, rate and spoken-text hash. Reuse only clips whose hashes, audio decoding and caption parsing all pass. Use temporary output files and rename on success so interrupted generation does not poison the cache. Retry transient failures twice; report failed scene IDs without suppressing the error.
- [ ] Measure decoded audio duration, parse provider subtitle timings, and normalize caption punctuation back to the display script where pronunciation spelling differs. Require positive duration and caption bounds within the clip (allow at most 100 ms provider rounding tolerance). Persist `media-manifest.json` only after validation.
- [ ] Generate short original 48 kHz WAV effects using Python standard-library `wave`: a decaying sine tap, a two-tone confirmation and seeded-noise whoosh with fade-in/out. Peak-limit source effects; no clipping. Keep narration at unity and effects around 0.12–0.2 initially, then assess the mix. Background music is optional; omit it unless it improves speech clarity.
- [ ] Implement the shared timeline with a 15-frame entrance lead, a minimum 24-frame tail, and integer-frame ceiling. Visual transitions stay inside those margins; adjacent spoken tracks never overlap.

```js
const narrationStartFrame = 15;
const durationInFrames = Math.max(
  Math.ceil(scene.minimumSeconds * fps),
  narrationStartFrame + Math.ceil(media.audioSeconds * fps) + 24
);
```

- [ ] Add Node tests covering actual failure modes, then implement validation until they pass. Use `node --test tests/*.test.mjs`.

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {createTimeline, toSrt} from '../scripts/timing.mjs';
const s = {id: 'W01', minimumSeconds: 3};
const m = {sceneId:'W01', audioPath:'audio/voice/W01.mp3',
  audioSeconds:7.2, captions:[{startMs:100,endMs:7200,text:'Nabasa ko na.'}]};
test('long speech extends the scene with a safe tail', () => {
  const t = createTimeline([s], {W01:m}, 30);
  assert.equal(t.durationInFrames, 255);
  assert.equal(t.scenes[0].narrationStartFrame, 15);
});
test('missing narration stops timeline generation', () => {
  assert.throws(() => createTimeline([s], {}, 30), /W01/);
});
test('subtitle offsets include the narration lead', () => {
  const text = toSrt(createTimeline([s], {W01:m}, 30), 30);
  assert.match(text, /00:00:00,600 --> 00:00:07,700/);
  assert.match(text, /Nabasa ko na\./);
});
```

- [ ] Add content validation cases for duplicate IDs, missing W12, an empty MP3, an out-of-bounds caption, an absent font and any `http:`/`https:` asset URL. Each failure must identify its scene or asset. Reject `..`/absolute public asset paths. Require exact total scene counts 12/12/20.
- [ ] Record the voice route, availability, installed dependency versions and sample-review result in `review/verification.md`. Do not call synthesized audio production-ready without the pronunciation check.

## Task 2 — Worker video and shared motion system

**Deliverable:** `WorkMateWorkers` previews end-to-end with its own opening/closing, all 12 scenes, voice, captions and effects.

- [ ] Read the prototype HTML and supplied fonts/logo; inspect screen proportions, card spacing, navigation and actual UI labels. Recreate synthetic worker states in `WorkerScenes.tsx`; do not use a screenshot of real logged-in data.
- [ ] Build local font loading, palette and safe-area layout in `theme.ts`/`styles.css`. At 1080p use a 64 px outer safe margin; reserve a bottom caption band. Minimum UI emphasis text should be readable at 720p playback. Dense detail screens get close-ups.
- [ ] Implement `Phone`, `Desktop`, `Pointer`, `Captions` and `SceneHeader`. All animation uses `useCurrentFrame`, `interpolate` and `spring`. Pointer/click timings are fixed frame numbers or narration-cue offsets. No perpetual bouncing/rotation while explaining a workflow.
- [ ] Register the composition with the validated timeline duration. Root entry is `index.ts` calling `registerRoot(Root)`. Sequence the scene renderer and its audio with the same `TimedScene` values.

```tsx
<Sequence from={timed.from} durationInFrames={timed.durationInFrames}>
  <WorkerScene scene={timed.scene} />
  <Sequence from={timed.narrationStartFrame}>
    <Html5Audio src={staticFile(timed.media.audioPath)} volume={1} />
  </Sequence>
  <Captions timed={timed} />
</Sequence>
```

`WorkerScene` consumes `Scene`; `Captions` consumes `TimedScene` and subtracts `narrationStartFrame` from its local frame. Verify these names against actual installed Remotion exports before compilation.

- [ ] Author W01–W12 exactly as the approved table: opening; Home/profile; attendance; request form; unlisted/urgent; leader/team quantities; offline/conflict; history preview; task acknowledgement; blocker/verification; tools preview; closing. Show at least two meaningful screen states for each workflow scene instead of repeating a generic card layout.
- [ ] Align tap/confirmation sounds to the illustrated action, not the scene start by default. Add within-scene entrance/exit motion that cannot obscure the first caption or last status.
- [ ] Run type checks and render W03/W06/W07/W10 key frames plus a short W03 audiovisual sample. Inspect for clipped text, hidden action targets, accidental amounts, wrong role controls and incorrect offline status. Review every scene's early/middle/late frames before accepting the worker edit.

## Task 3 — Procurement/Buying video

**Deliverable:** `WorkMateBuying` has its own complete 12-scene edit using the same brand, presenter and caption system.

- [ ] Implement B01–B12 in `BuyerScenes.tsx`: opening; list filters; claim/assignment; purchase details; partial purchase; shared receipt allocation; substitutes/unplanned; payment; receiving; offline/conflict; inventory preview; closing.
- [ ] Keep the buyer role visible and amounts masked. Use quantity data `needed:10, bought:6, stillToBuy:4`; preserve assignment of the four until the explicit release action. This is presentation data, not imported business arithmetic.
- [ ] Build separate visible states for purchase recorded, Paid/Unpaid and receipt confirmed. A payment click keeps the purchase ID and expense record count unchanged. Received stock changes only after the illustrated online receiving confirmation.
- [ ] Show one synthetic receipt object with two destination lines. Do not display two receipts or two payments for the same purchase. In the offline scene, shared counters remain unchanged until acceptance and conflict resolution.
- [ ] Render B05/B06/B08/B09/B10 key frames and the B05 audiovisual clip. Verify quantities, role masking, distinct states, captions and voice pronunciation. Review early/middle/late frames of all 12 scenes.
- [ ] Confirm shared component changes still render W03 and W07 correctly; only repeat worker checks affected by those changes.

## Task 4 — DAC’S Web video

**Deliverable:** `DacsWeb` presents all 20 approved office scenes, differentiating existing source modules from planned WorkMate integration.

- [ ] Inspect each shown local UI in its owning file before authoring: `js/admin.js`, `js/portal-app.compiled.js`, `js/expenses-module.js`, `js/boq-module.js`, `js/invoice-module.js`, `js/labor-invoice-module.js`, `js/payment-requests.js`, `js/overhead-module.js`, `js/reimbursement-module.js`, `js/pm-admin.js`, `js/termination-requests.js`, `js/warranty-fund.js`, `js/quotation-module.js`, `js/attendance-admin.js`, `js/construction-module.js`, `js/expense-inbox.js`, `js/client-accounts.js`, `js/user-navigator.js`, `js/ai-summary.js`, `js/error-log.js` and portal HTML. Read only; no app modifications.
- [ ] Map D01–D20 to source-backed panels and explicit preview panels in `WebScenes.tsx`. Retain the Web application's navigation grouping, card/table layout and recognizable labels. Add zoomed detail inserts for dense tables.
- [ ] Establish synthetic owner example figures that agree: contract 1,000,000, completion 50%, earned 500,000, labor 150,000, material 200,000, overhead 50,000, spent 400,000, earned profit 100,000; cover 20,000 is a labelled subset of spent. Display these only in owner-mode. Show Forecast separately without pretending its estimate is earned.
- [ ] Keep allocation planning visually separate from actual costs. Keep reimbursement, warranty and quotations isolated from the profit diagram. Quote Won ends in status/manual next step; warranty is an internal reserve, not client withholding.
- [ ] Use separate Project Control and Project Management chapter markers. For D15/D16, switch to visible planned/design-preview labels; do not imply WorkMate includes PM procurement or meetings already run in production.
- [ ] Show client/partner portal scenes as separate scoped examples, not one universally accessible admin screen. Show the staff view without owner-only modules/amounts. Weekly bonus appears only as an owner-only secondary tab, not automatic wage calculation.
- [ ] Render D04/D06/D08/D09/D11/D15/D16/D17 key frames and a D06 audiovisual clip. Review all 20 scenes at early/middle/late frames; record source-backed versus planned status in the verification note.

## Task 5 — Final renders, captions and delivery

**Deliverable:** three verified MP4s, three matching SRTs, editable source and final scripts.

- [ ] Implement `render.mjs` so it validates media before bundling, selects a registered composition, and writes to a known `out/` basename. Render one full video at a time with moderate concurrency (start at 2) to keep this computer usable. Log progress and keep commands resumable. Bundle once when rendering all three.

```js
const serveUrl = await bundle({entryPoint: entryPath, publicDir});
const composition = await selectComposition({serveUrl, id});
await renderMedia({
  serveUrl, composition, codec: 'h264', audioCodec: 'aac',
  pixelFormat: 'yuv420p', crf: 18, concurrency: 2,
  outputLocation, overwrite: false
});
```

`entryPath` is the absolute video `index.ts`; `publicDir` is its absolute `public/`; `id` is one of the three approved IDs; `outputLocation` is mapped to the approved filename. On an existing output, inspect it first and use a new revision filename or intentional replacement only after accounting for it.

- [ ] Use the actual provider timestamps for SRT and on-screen captions; add scene start and narration lead from the shared timeline. Group long phrases into at most two readable lines without inventing word-level timings. If sentence timestamps are too coarse, synthesize shorter approved phrases and regenerate their timing rather than distribute timestamps by character count.
- [ ] Run `npm run check`, `npm test` and `npm run validate` **inside the video project**. Root money tests are unnecessary because no money source changes. If implementation unexpectedly touches any application money module, stop and restore the isolated scope; any intentional change would require the repository's full validation.
- [ ] Render a short representative sample for each video, inspect it and resolve legibility/sync problems before full exports. If no agent-side audio playback tool is available, present the three sample clips for a user listening check while continuing frame and metadata verification.
- [ ] Render all three full compositions. Do not represent a render in progress, a silent audio stream or a partial MP4 as finished. Inspect metadata with Remotion's installed supported metadata tools and verify 1920 × 1080, 30 fps, the expected timeline duration within one frame, and a nonempty audio stream.
- [ ] Inspect opening, every scene boundary, long caption, final narration tail and final frame. Re-render only affected videos after changes. Record exact duration and file size, audio route, checks performed and any limitation in `review/verification.md`.
- [ ] Write `README.md` with Windows-friendly preview/render commands, dependency setup, editable script locations, voice provenance, asset attribution and local outputs. Include final scripts in `out/` as Markdown and deliver links to all outputs. Keep caches/dependencies outside the deliverable source set.

Expected final filenames:

```text
out/dacs-workmate-workers-taglish.mp4
out/dacs-workmate-workers-taglish.srt
out/dacs-workmate-buying-taglish.mp4
out/dacs-workmate-buying-taglish.srt
out/dacs-web-taglish.mp4
out/dacs-web-taglish.srt
out/taglish-narration.md
```

## Plan self-review

- Confirmed all 44 approved scenes are assigned to Tasks 2–4; narration and captions are covered by Tasks 1/5.
- Confirmed voice sample review precedes full audio generation, with explicit failure handling and no English-only substitution.
- Confirmed actual audio lengths determine timing and every SRT/render uses one shared timeline.
- Confirmed no app/database/deployment edits, no root build, no real business records and no automatic commits of rendered videos.
- Confirmed source ignore rules are handled locally so editable TSX/Python/media and lockfiles are not silently omitted.
- Confirmed tests target missing/corrupt assets, duration and caption errors; visual/audio checks cover role/status accuracy and readability.

**Handoff:** The storyboard is approved. Review this implementation plan and choose Native (recommended) or Subagent-driven execution. The next action after that review is to implement Task 1, not produce another storyboard.
