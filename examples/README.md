# examples/

Not consumer documentation — this is the external-consumer realism gate. CI's
`consumer-smoke` job (`scripts/consumer-smoke.mjs`) packs the library tarball,
installs it into `consumer/`, and runs typecheck, build, and SSR/hydration smokes
from outside the repo boundary, so exports-map, packaging, and dev/prod-channel
breaks fail here instead of at a real consumer after publish.

Consumers start at `docs/guide/consumer-guide.md` and `docs/guide/plugin-guide.md`.
If something is only learnable from this folder, that is a docs bug — file it in
`docs/issues.md`.

## Run it locally

From a fresh clone:

```sh
npm install        # repo root, once — installs the library's build toolchain
npm run package    # build dist/ (the example consumes the library from source)

cd examples/consumer
npm install        # links the local library + the example's own deps
npm run dev        # http://localhost:5173
```

The example depends on `aragonite` as `file:../..`, a link to this working tree —
no tarball to pin or refresh, so it never drifts from the source you cloned. The
plugin sources under `consumer/src/plugins/` are generated from the dev-harness
dogfood plugins (`scripts/sync-consumer-plugins.mjs`) before every `dev`, `build`,
`check`, and `test`; they are git-ignored and regenerate on first run.
