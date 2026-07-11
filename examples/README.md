# examples/

Not consumer documentation — this is the external-consumer realism gate. CI's
`consumer-smoke` job (`scripts/consumer-smoke.mjs`) packs the library tarball,
installs it into `consumer/`, and runs typecheck, build, and SSR/hydration smokes
from outside the repo boundary, so exports-map, packaging, and dev/prod-channel
breaks fail here instead of at a real consumer after publish.

Consumers start at `docs/editor/consumer-guide.md` and `docs/editor/plugin-guide.md`.
If something is only learnable from this folder, that is a docs bug — file it in
`docs/issues.md`.
