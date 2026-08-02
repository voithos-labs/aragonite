## What changed and why

<!-- One line is plenty. Link the issue if there is one. -->

## Gates

- [ ] `npm test` (full unit suite + every e2e project)
- [ ] `npm run check` (svelte-check, 0 errors)
- [ ] `npm run lint`

`npm run perf:check` reads red on anything but the calibration machine, by design, so don't tune to a local number. CI's scaled perf job is the arbiter.

## Before you submit

- Target branch is `dev`. `main` takes release merges only.
- Licensing is inbound = outbound: by submitting this change you license it under GPL-3.0-or-later, same as the rest of the project.
