# DAC's client appointments MVP

Date: 2 October 2026, Asia/Manila  
Document type: MVP scope and functional requirements  
State: Proposed specification; these features have not been implemented

## Purpose and operating model

Help one architect manage consultation requests, protect time for actual work, and keep clients informed with less manual messaging. DAC's has one architect responsible for every appointment. There is one calendar, one host, and one approval queue.

Clients request office, site, or online consultations. The architect approves the final schedule. Online clients select Google Meet or Zoom from the platforms the architect has connected. The system creates a meeting after approval, sends appointment emails, and supports reminders and a private appointment-management page.

Success means the client can tell whether the request is approved, knows when and where to attend, receives the correct meeting link, and can ask for a change. The architect sees one trustworthy schedule and a short list of tasks needing attention.

## Included features

| Feature | MVP requirement |
|---|---|
| Appointment request | Retain the existing four-step form; collect service, meeting type, project context, preferred schedule, and contact details. Online requests also collect platform choice. |
| Personal calendar | Day/week calendar for office, site, and online appointments; show confirmed appointments and blocked time. Pending requests appear in a separate queue and do not reserve a slot. |
| Availability controls | Working hours, blocked dates, meeting duration, daily appointment limit, and buffer time. Check every meeting type against the same calendar. |
| Approval and confirmed details | Review, approve, decline, or propose another schedule. Store preferred and confirmed schedules separately. |
| Automatic online meeting | Create a unique Google Meet or Zoom meeting for the approved date/time using the architect's connected account. |
| Appointment emails | Request receipt, approval/confirmation, schedule change, decline/cancellation, reminders, and client-facing follow-up when the architect sends it. |
| Private client tracking | A secure Manage appointment link works without a client account; display current status, schedule, location/link, checklist, and actions. |
| Rescheduling and cancellation | Clients request a new time; the architect approves it. Clients can cancel before the appointment begins after an explicit confirmation. |
| Preparation checklist | Service-specific instructions and a simple way to provide site photos, PDFs, and a map link before the meeting. |
| Daily action list | Today's meetings, pending/overdue requests, reschedule requests, failed meeting/email jobs, and overdue follow-ups. |
| Quick responses | Editable templates for requesting information, proposing another time, confirming, and following up. |
| Consultation notes and next steps | Private architect notes plus a separate client-facing summary with actions and a follow-up date. |
| Appointment history | Record who changed the appointment, when, and the client-visible reason where applicable. |

## Client journey

1. Select service and office, site, or online consultation.
2. For online consultation, select Google Meet or Zoom. Display only connected, available platforms; Google Meet is the default when available.
3. Enter project information and contact details; choose a preferred date/time from the offered request slots. Label the schedule as subject to approval.
4. Submit once and see an accurate receipt from the saved submission, plus a unique reference. Send a request-received email containing the private management link.
5. The architect approves the requested time or proposes another. A proposed alternative requires the client's acceptance before it becomes confirmed.
6. Once confirmed, show the final time, duration, and office address, site location, or online meeting link. Send the appropriate confirmation email and calendar invitation.
7. The management page supports preparation, viewing updates, requesting rescheduling, or cancelling before the start.
8. Receive reminders. On the day, use Join meeting for an online consultation; the architect starts/joins the meeting normally.
9. After the consultation, receive a summary only when the architect deliberately publishes it.

The short display reference is for correspondence. It is not a password and cannot unlock an appointment.

## Architect workspace

Keep appointment tools inside the existing Appointments navigation. Add Calendar, Requests, and Settings views with consistent role/module access checks.

The home view shows today's appointments with start time, meeting type, client name, service, location/link, and preparation completeness. Its action list prioritizes pending requests older than one business day, reschedule requests, integration failures, and overdue follow-ups. Business days follow configured working days and blocked dates; the client receipt promises review within one business day.

Each appointment opens its details, schedule, communication history, preparation files, and notes. Actions are Approve, Propose time, Decline, Cancel, Mark completed, Mark no-show, and Publish summary. Cancel and decline require a client-facing explanation. New workflow records are archived rather than routinely deleted so history remains available.

Owner controls availability, integrations, templates, and appointment mutations in this MVP. Preserve authorized staff access to a redacted list of contact, service, meeting type, schedule, and status. Staff responses must exclude budget/peso fields, unrestricted project messages, private notes, and intake attachments. Client-facing summaries must exclude private notes. Account roles do not create additional hosts or calendars.

## Scheduling rules

- Display Philippine time explicitly: Asia/Manila. Store confirmed start/end as timezone-aware instants; build local calendar date keys from local date parts.
- Proposed starting settings: Monday-Saturday, 9:00-17:00; 60-minute consultations; 90-minute site visits; 15-minute normal buffers; 60-minute buffers before and after site visits; maximum three appointments per day. These are editable recommendations and must be reviewed before opening booking.
- Keep the existing request horizon: tomorrow through three months ahead. Revalidate dates at submission and approval.
- Enforce duration, working hours, blocks, daily capacity, and buffers on the server. Approval must atomically reserve the time: concurrent approvals cannot create overlapping appointments.
- Pending requests and proposed alternatives do not reserve time. Recheck availability when an alternative is accepted.
- Cancellation releases the booking. A pending reschedule keeps the original confirmed slot. Reschedule approval swaps reservations atomically; a conflicting replacement leaves the original booking intact.
- The DAC calendar is the scheduling authority. External meetings must be entered as blocked time in the MVP; automatic import of unrelated calendar events is a later feature.

## Status and change rules

| Appointment status | Meaning |
|---|---|
| Pending | Received and awaiting review. |
| Confirmed | The final schedule is accepted and reserved. Online link readiness is shown separately. |
| Declined | The architect cannot accept the request; explanation provided. |
| Cancelled | Client or architect cancelled; actor/reason recorded. |
| Completed | Architect confirms the consultation occurred. |
| No-show | Architect records that the client did not attend. |

A proposed time or reschedule request has its own pending/accepted/declined state. It must not silently overwrite a confirmed schedule. Accepting an owner-approved proposal may confirm it only through the server's availability check; clients cannot write arbitrary statuses, mark completion, or change the host/platform after confirmation. Only valid transitions are accepted; restoring a cancelled or completed appointment requires a new request.

## Google Meet and Zoom

Create the meeting immediately after approval, scheduled for the confirmed day and time. Do not wait until that day to generate the link. Meeting creation does not automatically start the live consultation.

Connect the architect's Google and Zoom accounts through protected account authorization. Owner can reconnect/disconnect them and see connection health. Provider credentials and Zoom host URLs remain server-side/private; clients receive participant join links only. Use a unique conference for each appointment.

The integration stores provider meeting/event IDs, participant link, and a separate readiness state: pending, ready, or failed. Repeated approval/retry must reuse the appointment's operation rather than create another room. If a provider's response is ambiguous, reconcile the existing operation before retrying.

If creation fails, keep the schedule reserved, show Approved - meeting link pending, send an approval update explaining the link is being prepared, and alert the architect. Retry safely. Once ready, send the normal link-bearing confirmation. Do not show a successful room-creation message or a Join button before a real link exists.

Rescheduling queues a provider/calendar update for the latest schedule version; mark the link's readiness pending until reconciled. Cancellation disables joining in DAC's and queues provider cancellation. Failed external updates stay visible for retry; the public management page remains authoritative about cancellation/current schedule. Platform changes after confirmation are owner-controlled and notify the client.

Google Meet appointments create a Google Calendar event with conference details. Zoom appointments create a scheduled Zoom meeting and provide a calendar invitation file. Full synchronization of unrelated external calendar edits is outside this MVP.

## Email and reminders

| Trigger | Client message |
|---|---|
| Successfully saved request | Request received; reference, preferred schedule, pending approval, and private management link. |
| Proposed alternative | Proposed date/time and secure Accept/Decline actions. |
| Confirmed office/site appointment | Final schedule, duration, location, preparation checklist, and calendar invitation. |
| Confirmed online appointment with ready room | Final schedule, platform, join link, preparation checklist, and calendar invitation. |
| Online link creation failure | Approval update with a clear link-pending message; no fabricated link. |
| Reschedule requested | Acknowledgement that the original schedule remains in place pending review. |
| Reschedule approved/declined | Current confirmed details and the decision; revised invitation after approval. |
| Declined/cancelled | Explanation and how to make a new request. |
| Upcoming appointment | Reminder 24 hours and one hour before the confirmed start. |
| Published summary | Client-facing notes, next steps, and follow-up date. |

For short-notice confirmations, skip reminder times already passed. Schedule changes invalidate old reminders; cancellation, decline, completion, and no-show stop future reminders. If the room is not ready, send a truthful reminder with the management link and a pending-link notice, and flag urgent follow-up for the architect.

Queue email work durably after successful database changes. Use appointment ID, event, and schedule version to prevent duplicate automatic sends. Manual resends are separate, logged actions. A provider accepting an email means Sent; only a provider delivery event may mark it Delivered. Show queued, sent, delivered when available, failed, and bounced states. Record failures and offer a retry; email failure must not lose or falsely undo a saved appointment.

Use a verified transactional sender/domain with the architect's reply-to address. Do not treat password-reset email configuration as a general appointment-email service. Templates include the service, explicit timezone, current details, reference, and management link; internal notes and sensitive files are never attached automatically.

## Client management and preparation

Generate an unguessable appointment-specific token, store its hash, and validate it server-side. Do not expose list/read access to all appointment rows. Management links expire 30 days after the latest scheduled appointment date and can be revoked/reissued by the owner. Terminal appointment states remain viewable until expiry but cannot be mutated.

Client pages show only their own submitted fields, status/history messages, preparation checklist, shared summary, and meeting details. Changing client contact identity after submission is owner-reviewed. Reference-plus-email is insufficient authorization.

Preparation checklist defaults are editable by service: lot plan/measurements and design references for design, site photos and location for visits, and concerns/existing plans for renovation. Clients can mark items ready and upload up to five files per appointment, each up to 10 MB, JPEG/PNG/PDF only. Validate size/type server-side, store files privately, and use short-lived download access. Upload failure preserves the request and permits retry. Photos/documents are optional; site visits require a usable address or map link before approval.

## Consultation and quick responses

Keep private notes separate from the published summary. The architect records outcomes and a follow-up date; publishing is explicit and creates a client email job. Draft edits remain private. Marking completed does not invent notes or imply the client became a paying project.

Provide editable templates for asking for missing information, proposing time, confirming, declining, cancelling, and following up. Preview the final recipient/content before a manually composed message is sent. Show communication history and delivery state beside the appointment.

## Data and implementation boundaries

Retain plain HTML/vanilla JavaScript and the existing Supabase backend; no build step or framework migration. Add server-side operations for public submission, token-based access, atomic schedule changes, provider integrations, and queued notifications. Use a server scheduler/worker so reminders and retries run even when every browser is closed.

Extend appointments with real columns for platform, confirmed start/end, duration, location, schedule version, unique human reference, follow-up date, provider IDs/link state, and archive state. Store availability/blocks, history, proposed changes, token hashes, preparation files, and notification jobs/logs in appropriately protected related tables. Keep provider secrets in protected server configuration, outside public rows and browser code. Final schema names/types belong to the implementation plan.

Every new persisted field requires a real migration and schema documentation. Determine the next migration number from the actual highest number at implementation time. Verify migration 0084's columns and effective live appointment policies before relying on them. Public submissions must be limited to validated pending requests; callers cannot choose privileged statuses, timestamps, or integration fields.

Preserve legacy requests and their existing labels. Do not generate retroactive emails or meetings during migration. Legacy confirmed rows missing an actual schedule require owner review before entering the new calendar/reminder workflow.

Review this complete file surface before implementation:

| Area | Existing or planned surface |
|---|---|
| Public booking | index.html, js/booking.js, js/script.js, css/styles.css |
| Client tracking | New public management page/script with token-protected server endpoints |
| Admin | admin.html, js/admin.js; coordinated navigation/view/module permissions |
| Data | js/supabase-config.js where needed, new migrations and server operations |
| Integrations | Server functions, account connections, scheduled worker, email templates |
| Documentation | docs/DATABASE_SCHEMA.md, docs/ARCHITECTURE.md, this specification |
| Verification | tests/booking.test.js, workflow tests, database role checks, provider/email staging checks |

There is no existing appointment print/export path. Calendar invitations are the new export surface. Client tracking starts from email links and does not require a client-portal menu. If portal links are introduced later, mirror relevant HTML changes into both construction/partner portals.

Appointment budget information stays an intake estimate. Appointments do not create projects, folders, quotations, invoices, payments, or accounting entries and never enter Spent/Earned/Profit. Staff must not see peso amounts anywhere.

## Reliability fixes included in the MVP

- Capture and freeze the submitted snapshot during save; stale responses cannot complete a newer draft.
- Use a stable submission key and server deduplication for ambiguous-response retries.
- Revalidate dates and contact/field limits on the server.
- Refresh admin calendar/list/details consistently while preserving filters and search.
- Show loading/read/save errors and restore persisted status after failed mutations.
- Detect zero-row/stale-version mutations; record the actual actor and timestamp server-side.
- Stop and clear appointment subscriptions/caches on logout.
- Remove fixed 2026 chart logic; report appointments within an explicit date range and call completed/all appointments Completion rate.

## Release acceptance

The MVP is ready only when all of these work end to end:

1. Office/site/online clients submit valid requests and receive a correct receipt email with private tracking access.
2. Invalid/direct public submissions cannot set status to confirmed, spoof timestamps, bypass required fields, or read another request.
3. Concurrent approvals cannot double-book the architect, including site travel buffers and daily limits.
4. Both connected platforms create real, uniquely mapped meetings for the approved schedule; duplicate clicks/retries create no duplicate rooms.
5. Client confirmation, calendar invitation, and management page agree on final time and join link.
6. Provider failure produces truthful pending/failed states and a working recovery path.
7. Reminders run with browsers closed and do not send for old schedules or cancelled appointments.
8. Rescheduling preserves the original slot until approval and synchronizes the revised room/calendar details.
9. Client cancellation releases availability and queues external cancellation/email reliably.
10. Tokens/files isolate clients; staff receive no peso fields, attachments, or private notes; owner-only connections remain protected.
11. Active admin filters survive snapshots and mutations; errors are visible and logout clears state.
12. Checklists/files, response templates, published summaries, and follow-up tasks work on phone and desktop.
13. Email logs distinguish queued, provider-accepted, delivered when available, failed, and bounced; resends are explicit and logged.
14. Existing appointment checks plus targeted async, conflict, permission, reminder, and integration checks pass. Browser testing covers real owner login and client journeys.

## Delivery order and launch requirements

Build the MVP in four increments: reliability/data/access plus calendar; approval and both meeting providers; client management and email/reminder delivery; preparation/templates/summary and final end-to-end verification. These increments deliver one complete MVP, not four unrelated products.

Launch requires the architect's connected Google/Zoom accounts, a verified transactional email sender, protected credentials, and a deployed scheduler/worker. Validate current provider permissions/account limits during setup. Enable only providers actually connected and tested. The Zoom choice and complete dual-provider scope are not finished until both real meeting flows pass.

Exclude team routing, multiple architect calendars, paid bookings, SMS/WhatsApp automation, automatic project creation, AI consultation summaries, recordings/transcripts, automatic import of unrelated external calendar events, and a full CRM from this MVP.

## Supporting material

- [Existing module analysis](../../../reports/Client%20appointments%20module%20analysis.md)
- [Repository architecture](../../ARCHITECTURE.md)
- [Google Calendar conference creation](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [Zoom scheduled meeting API](https://developers.zoom.us/docs/api/meetings/)
- [Google Calendar confirmation/reminder patterns](https://support.google.com/calendar/answer/10729749?hl=en)
- [Supabase scheduled server functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase server secrets](https://supabase.com/docs/guides/functions/secrets)

This document defines proposed product scope and release requirements. It does not claim that accounts are connected, migrations are deployed, or any new feature is live.
