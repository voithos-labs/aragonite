## What changed and why

<!-- One line is plenty. Link the issue if there's one. -->

## Gates

- [ ] `npm test` (full unit suite + every e2e project)
- [ ] `npm run check` (svelte-check, 0 errors)
- [ ] `npm run lint`

Don't chase `npm run perf:check` on your own machine unless it's the calibration machine: it builds and previews the app, then measures keystrokes against baselines taken on one pinned desktop, so anywhere else it reads red by design. CI runs it with a scale factor for its slower runners, and that's the run that has to be green.

## Before you submit

- Target `dev`. `main` only takes release merges.
- Inbound = outbound: by submitting this you license the change under AGPL-3.0-or-later, same as the rest of the project.
