# Feature: Virtual rendering — live mode windows like every other rung

Windowing activates on a scope's modeled height alone; the presentation mode is
not an input. Live mode's blocks are the heavy ones (highlighted code, rendered
math, diagrams), which is the case for a bounded mount rather than against it:
an unwindowed live document pays O(document) on every keystroke's reactive
flush, the cost the README's O(viewport) claim rules out. Driven on
`/test/editor?presentationMode=live` over a document of headings, prose,
highlighted fences and lists, tall enough to window several times over, with a
real wheel gesture over the editor's own scrollport.

Miss-analysis: every windowing scenario loads its fixture in source mode, and
every live-mode scenario loads a document too short to window, so a mode-keyed
activation gate turned live into an all-mounted document with nothing to fail;
only the perf gate's live rows saw it, as a 26x keystroke.

## Happy paths

- a heavy document opened in live mode mounts a bounded window (top-level
  hosts under the shared ceiling and under a tenth of the block count, spacers
  present) and keeps the peak under the ceiling through a real wheel scroll
  with the pointer over the editor: the window moves, it does not accumulate
- a flip from source into live (a real click on the header's live toggle),
  scrolled into the middle of the document, keeps the window it entered with
  rather than mounting everything

## Edge cases

- every mounted-set ceiling carries the shared coverage floor: the mounted band
  reaches both edges of the scrollport, before and after the scroll

## Error cases

- no page errors surface during load, scroll or flip
