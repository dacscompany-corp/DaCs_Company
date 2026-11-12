# WorkMate redesign — Phase 4: History (design)

**Status:** design approved by the owner 12 November 2026 ("approved"); this spec awaits review.
**App:** DAC's WorkMate (`C:\Users\John Aerol Tapales\Documents\Dacs WorkMate`), base `main` at `bfc587e`
(0.14.3+1022, published 12 Nov). **Target:** `0.15.0+1023`. **No server change.**
**Source:** the Claude Design handoff (variant 1a "Inbox"), History tab and day sheet.

## 1. Purpose

History (the worker's own attendance days) already has the right content. Phase 4 gives it the mockup's layout: a
segmented Week / Month switch, day cards with Time In and Time Out side by side, and a day sheet that shows the two
photos large.

## 2. What does not change

- Which days show (the range's days with the gaps), the summary numbers, `HistoryController` and every server read.
- Pull-down refresh, the failure notice with Retry, the loading spinner.
- The words: "My attendance", "Your recorded days", "Week", "Month", "N days worked", "this week" / "this month",
  "total", "Time In", "Time Out", "not yet", "No record", and the pills "Working", "Not closed", "Not sent yet" and the
  day's hours.
- The full-screen photo viewer (`PhotoViewer`, "PROOF").
- A Time Out that has not happened names no place.

## 3. The History tab

1. **Title** "My attendance" (26/800); subtitle "Your recorded days" (14, muted, 2 below).
2. **Week / Month switch** (14 below): one track across the full width (background `inert`, radius 999, padding 4,
   gap 4) with two equal halves, height 38, 14 px. Selected half: white, text 800 in `text`; the other: transparent,
   text 600 in `textMuted`. Keys `span-week`, `span-month`. TalkBack hears which one is selected.
3. Failure notice / spinner as today; otherwise the **summary card** as today (white, radius 20).
4. **Day cards** (12 below the summary, 8 apart):
   - **No record:** the grey block as today (radius 16).
   - **A recorded day:** white, radius 16, padding 14, border `border` (the open day: `greenBorder`, 1.5). Tapping it
     opens the day sheet (ripple). Key `day-<workDate>`.
     - Row: the date (15/800) and, on the right, "Not sent yet" (brown, when the record is still on the phone) and the
       day's pill (hours / Working / Not closed).
     - **Two equal columns** (10 below, gap 8): **Time In** and **Time Out**. Each: a 30-px round icon (Time In
       `south_west`, green on a green 12 % tint; Time Out `north_east`, brown on a brown 12 % tint; a leg that has not
       happened: faint icon on `canvas`), then the label (12; disabled colour when not yet) over the time (IBM Plex
       Mono 14.5/700; "not yet" in 14 disabled).
     - **Place line** (8 below, 12.5, muted): the Time In project; when the Time Out project is known and different,
       "In: A · Out: B"; no line when neither is known.
     - No photo thumbnails on the card.

## 4. The day sheet

Tapping a recorded day opens a `WmSheet` (not tall), key `day-sheet`, titled with the date ("Wednesday, 26 Aug").
- The pills as on the card ("Not sent yet", then the day's pill).
- **Two photo cards side by side** (12 below, gap 10), Time In then Time Out. Each: white, radius 16, border, clipped;
  a photo area (height 120) — the photo when its link resolves, otherwise a `canvas` box with a faint photo icon; under
  it (padding 10 / 12) the label (12.5), the time (IBM Plex Mono 16/700, or "not yet" in disabled) and the project
  (12.5, muted; none for a Time Out that has not happened).
- A photo that loaded opens the full-screen `PhotoViewer` when tapped, with the same heading and caption as today
  ("Time In · 7:45 AM"). Keys `day-photo-in`, `day-photo-out`.
- A photo link is asked for only when the sheet opens (the list no longer asks for any).

## 5. How it is built

| Piece | Where |
|---|---|
| Tab, switch, cards, day sheet | `lib/attendance/history/history_screen.dart` (the sheet as `DaySheet` in new `lib/attendance/history/day_sheet.dart`) |
| Version | `pubspec.yaml` → `0.15.0+1023` |

## 6. Testing

- Existing `test/attendance/history/history_screen_test.dart` facts stay (week with a closed day, a gap and an open
  day; "Not sent yet"; Month asks for the whole month; offline + Retry; pull-down; the photo viewer).
- New: the switch marks the selected half and Month still reads the month; the two legs sit side by side on a card; the
  place line ("In: A · Out: B" when different; one name when the same); a "No record" block does not open anything;
  tapping a day opens the sheet with both legs, the pills and the places; no photo link is asked for until the sheet
  opens; a loaded photo opens the viewer; "not yet" on an open day's Time Out with no place.
- Full `flutter test` and `flutter analyze` clean.

## 7. Acceptance

1. Week / Month is one segmented switch; switching reads the right range.
2. Every recorded day shows Time In and Time Out side by side and its place line; gaps stay grey blocks.
3. Tapping a day opens the day sheet with the two photo cards; tapping a photo opens it full screen.
4. All tests and the analyzer pass. The phone check comes **before** publishing build 1023.
