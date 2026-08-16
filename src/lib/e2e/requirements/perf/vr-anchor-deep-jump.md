# Feature: Virtual rendering — scroll-anchor correction on a deep jump (VR-2)

A single deep `scrollTop` jump lands in a fresh estimate-seeded band whose blocks then measure
in far taller than estimate. The editor shifts `scrollTop` forward by the model-offset delta so
the content the reader was looking at stays in view. The settled `scrollTop` compensation is the
discriminator — within-flush block drift reads flat, and reverting the correction pins
`scrollTop` at the exact jump target. Once per responsible scope.

## Happy paths

- Deep jump into an unmeasured band at the ROOT scope holds the viewport: on a doc the estimator badly under-models (tall `<br>`-heavy paragraphs interleaved with short ones), the compensation runs to thousands of px on a 30×-under-modeled fixture.
- Deep jump into a giant blockquote holds the viewport at the NESTED scope: `correctAnchor` is instantiated per scope, and the root arm guards only the root instance. The compensation is nested-attributable because the single top-level block leaves the root scope's anchor offset structurally 0 (no-op) — only the blockquote's own scope, whose paragraph children enroll in the `correctAnchor`-wrapped batched measure pass, can produce it.

## Edge cases

- A mounted block still sits at the viewport's top edge either way, so block position is a sanity check and never the discriminator.

## Error cases

- No page errors surface during either jump.
