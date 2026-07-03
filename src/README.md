# ⚠️ STALE SOURCE — do not rebuild from here

`portal-app.jsx.stale-2026-06-03` is an **outdated snapshot** of the admin
"Project Control" React portal. Since June 3, 2026 all changes (labor
contracts/pakyaw, and everything after) were made **directly in
`js/portal-app.compiled.js`**, which is the live, loaded file and the only
source of truth.

- Do NOT run `npm run build` — the scripts in `package.json` are disabled on
  purpose and will refuse to run. Rebuilding from this stale source would
  overwrite the live portal with a month-old version.
- To change the portal: edit `js/portal-app.compiled.js` directly (it is
  readable, non-minified JS).
- `js/dacs-portal/*.jsx` are even older module drafts (May 2026) — also stale,
  never loaded by the browser.
- The old sourcemap (`js/portal-app.compiled.js.map`) was deleted for the same
  reason; the `//# sourceMappingURL` line was removed from the compiled file.

If a real JSX pipeline is ever wanted again, the compiled file must first be
back-ported into JSX and verified feature-by-feature against the live portal.
