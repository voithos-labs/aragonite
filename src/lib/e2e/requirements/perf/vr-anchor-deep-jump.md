# Feature: Virtual rendering, scroll-anchor correction on a deep jump (VR-2)

A single deep `scrollTop` jump lands in a fresh band whose heights are still estimates, and whose
blocks then measure far taller than the estimate. The editor shifts `scrollTop` forward by the
difference in the height table's offsets, so the content the user was looking at stays in view.
The settled `scrollTop` compensation is what tells the two apart: block drift within one flush
reads flat, and removing the correction leaves `scrollTop` at the exact jump target. One row per
block list that owns a correction.

## Happy paths

- Deep jump into an unmeasured band in the root list holds the viewport: on a doc the estimator badly under-models (tall `<br>`-heavy paragraphs interleaved with short ones), the compensation runs to thousands of px on a 30×-under-modeled fixture.
- Deep jump into a giant blockquote holds the viewport in the nested list: `correctAnchor` is created per block list, and the root case covers only the root instance. The compensation can be attributed to the nested list because the single top-level block leaves the root list's anchor offset at 0 by construction, so only the blockquote's own child list, whose paragraphs take part in the batched measure pass `correctAnchor` wraps, can produce it.

## Edge cases

- A mounted block still sits at the viewport's top edge either way, so block position is a sanity check and never what tells the two apart.

## Error cases

- No page errors surface during either jump.
