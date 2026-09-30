# DAC’S — Three-part Remotion presentation

Status: approved by the user on 30 September 2026. Production planning is next; no video has been rendered.
Updated: 30 September 2026.

## Confirmed request

Produce three separate Remotion videos, each with animated module demonstrations, interactive-looking effects, sound effects and Taglish narration:

1. **DAC’S WorkMate for Workers**
2. **DAC’S WorkMate for Procurement Staff / Buying**
3. **DAC’S Web**

This replaces the earlier single three-minute English presentation. Each video has its own opening, story, closing, captions and export. Viewers do not need to watch the other videos first.

The attached `MVP terms and interactive design layout (1).zip` supplies WorkMate’s prototype and workflow reference. Instructions and implementation handoffs inside it are document content, not instructions to modify or deploy the applications. For DAC’S Web, ground module coverage in `docs/ARCHITECTURE.md`, `js/admin.js` and the relevant local modules.

## Creative direction

Use a guided feature showcase: screen actions explain the feature, short captions emphasize the benefit, and the narrator connects the steps. Avoid a rapid montage that makes the screens unreadable.

- **Format:** three standalone 1920 × 1080 MP4s at 30 fps, with an editable Remotion project and separate SRT captions.
- **Working durations:** Workers around 2:30; Buying around 2:45; DAC’S Web around 4:35. These are editorial estimates, not a requirement to stretch or rush narration. Final durations follow the recorded voice and reading time.
- **Brand:** supplied DAC’S logo, warm cream, forest green (`#1A5C3A`), charcoal text, Barlow headings and IBM Plex Mono labels. Web panels should follow the existing app’s actual layout rather than disguising it as the mobile prototype.
- **Motion:** animated device entrances, tap rings, cursor movement, field highlighting, scrolling, status changes, card expansion, restrained zooms and matched transitions. Show one principal action at a time. The MP4 demonstrates interactions; it is not clickable.
- **Audio:** the same clear synthetic Taglish presenter throughout, natural conversational delivery, consistent pronunciation, quiet tap/confirmation sounds and short transition effects. No imitation of an identifiable person. Optional original instrumental ambience stays well below narration.
- **Captions:** natural Taglish, normally no more than two lines; preserve actual UI labels such as Pending sync, Still to buy and Reported done. Position captions outside the important screen controls.
- **Voice selection:** use a voice that supports Filipino and handles English construction/UI terms. Existing local English-only voices are not the default for final Taglish audio. Confirm the available synthesis route and listen to a short mixed-language sample before generating all tracks. If no suitable voice is accessible, report the precise missing resource; do not silently export an English-only or unnarrated substitute.
- **Pronunciation:** DAC’S = “Daks”; WorkMate = “work-meyt”; BOQ = “bee-oh-kyoo”; pakyaw uses its normal Filipino pronunciation. Read acronyms as letters where needed. Numbers may use natural spoken Filipino/English while screen labels remain exact.
- **Feature status:** WorkMate footage retains `PRODUCT PREVIEW · SAMPLE DATA`. Later-stage inventory/tools/cost integration uses `PLANNED MODULE`; meetings uses `DESIGN PREVIEW`. The Web film identifies prototype-only WorkMate additions when transitioning from existing Web modules. Do not present repository evidence as proof of a production deployment.

## Video 1 — DAC’S WorkMate for Workers

**Audience:** workers and team leaders. **Focus:** a clear day on site. **Estimated duration:** 2:30.

Phone-led scenes. Team-leader actions receive their own role badge. Show no procurement prices or financial receipts in worker/leader views. Profile and account continuity appear in the opening; request updates and task changes appear throughout.

| ID / seconds | Scene and visual action | Taglish narration |
|---|---|---|
| W01 / 10 | Logo → phone Home. Title: “Kasama sa bawat araw sa site.” | Ito ang DAC’S WorkMate para sa workers at team leaders. Sa product preview na ito, tingnan natin kung paano magiging mas malinaw ang araw mo sa site. |
| W02 / 10 | Home: Time In, request updates, My Work; profile insert. | Pag-sign in gamit ang account mo, nasa Home ang attendance, request updates, at mga kailangang balikan. Isang tingin, alam mo kung saan magsisimula. |
| W03 / 16 | Eligible site → photo → review → Time In; Time Out and history. | Para sa attendance, piliin ang enabled na site, kumuha ng photo, i-check ang details, at mag-submit. Sa Time Out, sundan ulit ang steps at balikan ang record sa History. |
| W04 / 17 | New Request; project, Main Contract/AW; material and tool lines. | Kailangan ng materials o tools? Gumawa ng request para sa tamang project at work scope. Ilagay ang specification, unit, at quantity para malinaw kung ano talaga ang kailangan sa site. |
| W05 / 12 | Unlisted item photo; one item marked Urgent. | Wala sa listahan ang item? Idagdag ang description at helpful na photo. Kung urgent, i-flag ang mismong item para madaling makita ng office. |
| W06 / 14 | Leader badge; assigned team; combined list; 10 arranged + 2 later. | Para sa team leader, puwedeng pagsamahin ang needs ng assigned team. Kapag may dagdag na quantity, makikita kung alin ang arranged na at alin ang nasa susunod na batch. |
| W07 / 14 | No signal → Pending sync → online → conflict preserved. | Walang signal? Ang supported offline actions ay puwedeng ma-save muna sa phone. Pending sync means hindi pa ito accepted ng office. Kapag may conflicting changes, makikita ang kailangang ayusin. |
| W08 / 12 | Planned Find Previous Item: approved photos, specs, new draft. | Sa planned Find Previous Item, mas madaling hanapin ang dating item gamit ang authorized photos at specifications. Piliin ang tama, saka gumawa ng bagong request. |
| W09 / 16 | Design preview My Work; task owner/helpers; I’ve read this; shared notes. | Sa My Work preview, makikita ang assignment, schedule, at shared meeting notes. I-tap ang I’ve read this para alam ng office na nabasa mo ang instructions. |
| W10 / 14 | Report missing materials; blocker; Reported done → staff verification. | May kulang na material o hindi pa tapos na preparation? I-report ang blocker. Kapag tapos na ang trabaho, i-report ito para sa checking at final verification ng office. |
| W11 / 9 | Planned My Tools: asset, named responsibility, handover/return. | Sa planned My Tools, makikita ang tool na naka-assign sa iyo, kasama ang handover at return details nito. |
| W12 / 6 | Home/requests/work montage → logo. | DAC’S WorkMate. Mas malinaw ang request, mas klaro ang gagawin sa site. |

**Editorial notes:** Do not suggest a request-only site is automatically eligible for attendance. Do not equate attendance hours with pay. Acknowledgement is separate from starting or completing work. A leader check is not final completion approval. Show staff verification as an office status, not a worker-accessible button. Offline footage must visibly retain unsent/conflict status until simulated acceptance.

## Video 2 — DAC’S WorkMate for Procurement Staff / Buying

**Audience:** authorized buyers, procurement staff, admin and owner. **Focus:** from assigned buying list to properly recorded receipt. **Estimated duration:** 2:45.

Phone-led purchasing scenes, with occasional request/office handoff inserts. Keep the buyer role badge visible. For the initial presentation, mask peso values so the video does not assert that the proposed staff financial-access exception is already implemented; existing repository instructions still apply. Quantity demonstrations remain fully visible.

| ID / seconds | Scene and visual action | Taglish narration |
|---|---|---|
| B01 / 10 | Logo → buying workspace. Title: “Mula shopping list hanggang receiving.” | Ito ang DAC’S WorkMate para sa Procurement Staff at Buying. Sa preview na ito, sundan natin ang flow mula assigned items hanggang purchase at receiving. |
| B02 / 14 | Shopping list; batch/project filters; urgency and changed-quantity badges. | Sa buying list, makikita ang project, quantity, urgency, at importanteng changes. Puwedeng ayusin ang view by batch o project para malinaw ang uunahin. |
| B03 / 14 | Assigned portion; I’ll buy this on unassigned portion; named buyer. | May items na assigned sa iyo. Para sa available na portion, puwede mong piliin ang I’ll buy this habang online. Makikita ng ibang authorized buyers kung sino ang may hawak. |
| B04 / 15 | Record actual item/spec/unit, supplier/date, receipt; values masked. | Sa pagbili, i-record ang actual item, specification, quantity, supplier, at purchase date. Ilakip ang receipt at kumpletuhin ang purchase details para malinaw ang record. |
| B05 / 14 | Needed 10 → Bought 6 → Still to buy 4; release remaining portion. | Halimbawa, sampu ang kailangan at anim ang nabili. Bought: six. Still to buy: four. Sa iyo pa rin ang natitirang assignment, maliban kung i-release mo ito. |
| B06 / 15 | One receipt, two project lines; Main Contract/AW/warehouse destinations. | Isang receipt, maraming project items? I-attach ito nang isang beses, tapos itugma ang bawat line sa tamang project at work scope, o sa warehouse destination. |
| B07 / 13 | Original and substitute side by side; required reason; unplanned purchase. | Kung may substitute, panatilihing visible ang original request at ilagay ang dahilan ng replacement. May unplanned purchase? Kailangan din ng reason at tamang destination. |
| B08 / 15 | Unpaid → payment details → Paid; same purchase ID persists. | Hiwalay ang pagbili sa pagbabayad. Puwedeng Unpaid muna ang purchase. Kapag bayad na, idagdag ang payment details sa parehong record, nang walang panibagong material expense. |
| B09 / 15 | Awaiting delivery → explicit received qty/location/condition → usable stock. | Hiwalay din ang delivery. Para sa direct-to-site receiving, i-confirm habang online ang actual quantity, location, at condition. Receipt photo lang ay hindi pa proof na available ang stock. |
| B10 / 15 | Offline purchase draft/photo → Pending sync → assignment conflict. | Walang signal sa supplier? I-save muna ang supported purchase details at photos bilang draft. Pending sync pa ito. Sa reconnect, iche-check ang changes bago ma-update ang shared records. |
| B11 / 15 | Planned warehouse/site balances, reservations, partial receiving, returns. | Sa planned inventory workflow, malinaw ang warehouse at site quantities, kasama ang reservations, receipts, issues, transfers, at returns. Ang confirmed na usable quantity lang ang magiging available. |
| B12 / 10 | Request → buyer → receipt → receiving recap and logo. | DAC’S WorkMate for Buying. Klaro kung sino ang bibili, ano ang nabili, ano pa ang kulang, at ano ang natanggap. |

**Editorial notes:** Claims and reassignment require connectivity. Do not automatically release unbought quantities after a partial purchase. Payment is not receiving; recording a purchase is not inventory confirmation. Shared receipts must not expose another project's details to unauthorized viewers. Offline purchase drafts do not update shared totals. Procurement permissions in the attachment describe a proposed workflow and do not change AGENTS.md or live access controls.

## Video 3 — DAC’S Web

**Audience:** owner/admin and authorized office staff; owner-only modules are explicitly marked. **Focus:** the full Web platform, with a separate preview chapter for the planned WorkMate office workflow. **Estimated duration:** 4:35.

Desktop-led scenes with legible panels rather than an entire dense dashboard squeezed into every shot. Use owner-mode sample data for monetary panels and owner-only modules. On staff-mode inserts, hide peso amounts and restricted controls. This third video covers more than the WorkMate admin queue because the user named DAC’S Web separately.

| ID / seconds | Scene and visual action | Taglish narration |
|---|---|---|
| D01 / 10 | Logo → desktop; main navigation reveals. | Ito ang DAC’S Web, ang workspace ng office para sa projects, records, billing, at coordination. Tingnan natin ang major modules, pati ang planned connection sa WorkMate. |
| D02 / 10 | Role-specific nav; Users/Navigator; owner versus limited staff. | Sa Users at access settings, nakaayon sa role at allowed modules ang makikita ng bawat account. Owner-only information ay may sariling restrictions. |
| D03 / 15 | Owner Project Control: folder grid → project detail; main/AW. | Sa Project Control, magkakasama ang project overview, billing periods, additional works, at cost details. Mula sa summary, puwedeng mag-drill down para makita kung saan nanggagaling ang figures. |
| D04 / 16 | Owner cost breakdown: Labor/Material/Overhead; allocation plan separate. | Hiwalay ang Labor, Material, at Overhead para malinaw ang gastos. Ang billing allocations naman ay planning guide; hindi ito automatic na dagdag sa revenue, cost, o profit. |
| D05 / 14 | Payroll/material records, pakyaw cap, cover subset highlighted inside cost. | Sa expense at labor records, makikita ang supporting details at pakyaw contracts. Kasama na sa total cost ang Cover expenses; hindi ito idinadagdag ulit bilang panibagong bucket. |
| D06 / 15 | BOQ line progress → accomplishment → Earned; Forecast clearly labelled. | Sa Accomplishment, binabalikan ang progress ng bawat BOQ item. Dito nakabatay ang earned revenue. Kapag wala pang accomplishment data, malinaw ang Forecast label sa kaukulang estimate. |
| D07 / 14 | Invoice/receipt, labor invoice, payment review; print/PDF/CSV. | Para sa billing, nandito ang invoices, labor invoices, at payment requests. Puwedeng i-review ang records at gamitin ang available print, PDF, o CSV outputs ng module. |
| D08 / 11 | Company overhead separate; isolated reimbursement register. | May hiwalay na company overhead at owner-only reimbursement tracker. Ang reimbursement status ay tracking record; hindi ito automatic na bagong invoice, payment, o project expense. |
| D09 / 18 | Project Management chapter; project → daily costs → milestones/procurement. | Sa Project Management, may sariling projects, daily expense records, weekly billing, procurement, at milestones. Hiwalay ito sa Project Control, kaya hindi dapat paghaluin ang kanilang project records. |
| D10 / 14 | Daily logs/walkthroughs/accomplishment/revolving fund detail cards. | Para sa site operations, may daily logs, walkthroughs, accomplishment reports, at revolving fund records. Tinutulungan nitong balikan ang updates at supporting details ng isang project. |
| D11 / 16 | Owner closeout: Completed/Terminated, final bill; warranty reserve register. | Sa Project Closeout, malinaw kung completed o terminated ang project. May hiwalay ding Warranty Fund register para sa internal company reserve; hindi ito deduction sa client billing. |
| D12 / 12 | Owner quotations: itemized proposal → revision → Won; manual next step. | Sa Quotations, gumawa ng itemized proposal, revisions, at status tracking. Ang Won na quotation ay hindi automatic na project o revenue; hiwalay pa rin ang admin action. |
| D13 / 15 | Attendance Today → photos/history → roster/sites → hours report; updates insert. | Sa Attendance, tingnan kung sino ang nasa site, i-review ang Time In at Time Out records, at pamahalaan ang workers at sites. May hours reports at owner controls para sa app updates. |
| D14 / 14 | Construction: batches/urgent/history/inventory; Expense Inbox receipt queue. | Sa Construction, may batches, urgent requests, history, at inventory. Sa Expense Inbox, puwedeng ipunin ang shared receipt photos para sa tamang review at encoding. |
| D15 / 22 | Explicit PLANNED WORKMATE chapter; request queue → matching → schedule → owner cost review. | Para sa planned WorkMate workflow, dito rerepasuhin ng office ang requests, catalogue matching, teams, at schedules. Kasama sa later stages ang item history, tool register, at owner-reviewed cost assignments, na malinaw ang pagkakaiba ng stock movement at project cost. |
| D16 / 20 | DESIGN PREVIEW: notes → AI/manual drafts → review → publish → acknowledgements/blockers/final check. | Sa Meetings at Work Plan preview, puwedeng gawing draft tasks ang notes. Staff pa rin ang magre-review at magpa-publish. Makikita ang acknowledgements, blockers, at work na naghihintay ng final verification. |
| D17 / 14 | Design/construction client and partner portal frames; scoped project view. | May hiwalay na portals para sa design clients, construction clients, at partners. Ang bawat audience ay may sariling project experience at access sa mga records na para sa kanila. |
| D18 / 10 | Appointments → analytics → feedback montage. | Nandito rin ang appointments, analytics, at feedback para masubaybayan ang inquiries at client interactions sa public-facing side ng business. |
| D19 / 10 | Reports, AI summary, owner System Errors; user navigation recap. | Para sa review, may reports at AI-assisted summaries. May owner-only System Errors view rin para makita ang reported issues at masundan ang investigation. |
| D20 / 5 | Desktop → phone trio → logo. | DAC’S Web. Mas malinaw ang records, mas maayos ang coordination mula office hanggang site. |

**Editorial notes:** Before using a detailed screen action in production, verify its local module implementation, not just a module label. Do not imply all modules have identical export formats. Keep Project Management separate from WorkMate's Project Control flows. Weekly bonus can appear as a secondary Attendance tab in an owner-only insert; it must not be described as an automatic wage calculation. Warranty, reimbursement and quotations remain outside project money calculations. AI summaries are aids, not guaranteed financial analysis. No release availability or date is inferred from a local prototype.

## Assets, facts and narration

1. Use synthetic people, projects, dates and amounts. Do not capture real customer, employee or financial records.
2. Preserve the bundled logo and local fonts. Reference the prototype’s UI and recreate planned module scenes explicitly as previews.
3. Keep narration in natural Taglish, with familiar construction and UI terms in English. Avoid translating labels differently from what the viewer sees.
4. Source conflicts are not new requirements: the archive contains multiple document versions. Do not promise a particular meeting release stage or settled staff permissions where current instructions disagree.
5. Generate one narration clip per scene, then set frame duration to voice duration plus intentional screen-reading time. Include opening/closing pauses. No clipped final syllables or overlapping consecutive narration.
6. Produce original short tap, pop and whoosh sounds. Mix them below the voice; avoid abrupt endings, excessive loudness or repeated alert sounds suggesting real notifications.
7. Keep captions synchronized with the actual spoken track, including acronym pronunciation. Deliver one caption file per video.

## Production structure

Keep the isolated Remotion project at `video/workmate-showcase/`, with its own package manifest and lockfile. Do not change the root application build scripts, recreate application JSX sources, modify application modules or run the repository's disabled build command.

Use one shared visual/audio system with three independently registered compositions:

| Composition | Output |
|---|---|
| `WorkMateWorkers` | `out/dacs-workmate-workers-taglish.mp4` and `.srt` |
| `WorkMateBuying` | `out/dacs-workmate-buying-taglish.mp4` and `.srt` |
| `DacsWeb` | `out/dacs-web-taglish.mp4` and `.srt` |

Proposed files:

- `package.json`, lockfile and `remotion.config.ts`: isolated preview/render setup.
- `compositions/Root.tsx`: register all three videos.
- `compositions/Showcase.tsx`: shared deterministic sequence, captions, transitions and audio.
- `compositions/components/`: phone/desktop frames, cursor/tap animation and shared typography.
- `compositions/scenes/`: focused worker, buyer and Web scene implementations.
- `content/workers.json`, `content/buying.json`, `content/web.json`: stable scene IDs, narration, captions and status labels.
- `public/brand/`, `public/screens/`, `public/audio/`: local render assets, synthetic visuals, narration and original effects.
- `scripts/`: validate media, assemble timing/captions and render individual/all videos.
- `README.md`: edit/preview/render instructions, audio source, attribution and output locations.

Motion derives from the Remotion frame; no CSS-clock animation or live application state controls rendered timing. Rendering reads local assets and synthetic data, with no production database queries or runtime voice generation. Missing narration, assets or scene timings must stop validation rather than silently export an incomplete film.

## Acceptance and review

- Verify complete audience-specific coverage against the prototype, source documents and current Web module map.
- Verify all three videos have separate openings, closings, Taglish narration, captions, effects and MP4 exports.
- Validate the Filipino/English voice sample before producing the complete soundtrack; check pronunciation and natural phrasing.
- Check representative frames from every scene, especially long labels, captions, mobile legibility and monetary role restrictions.
- Preview each cut at normal playback speed for tap/action alignment and adequate reading time.
- Inspect exports for expected dimensions, frame rate, duration, audio track, clean transitions, unclipped speech and synchronized subtitles.
- Verify planned/prototype labels and absence of real personal/financial data.
- Deliver three playable MP4s, three SRTs, the editable project and the final Taglish scripts.

The user approved this revised storyboard on 30 September 2026. It replaces the previous single-video storyboard and is the creative brief for implementation planning. Videos remain unrendered at this stage.

