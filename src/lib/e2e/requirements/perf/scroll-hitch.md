# Feature: scroll hitch — what a wheel tick costs in live mode over heavy blocks

Report-only rows, printed by `npm run perf:e2e` and skipped by the gate. Live
mode's blocks are the heavy kinds (highlighted fences, rendered math, diagrams),
and windowing mounts and unmounts them as the reader scrolls, so this is where a
wheel tick would hitch. Two rows: code and prose on the editor route, and math,
code and diagrams on the plugins route, each a document tall enough to window
many times over, scrolled by real wheel ticks with the pointer over the editor.

## Measurement semantics

- per tick: block hosts mounted and unmounted (a mutation census under the
  editor), programmatic `scrollTop` writes (the scroll correction, counted at
  the editor's own setter), long tasks, the worst rAF gap, how far the tick
  scrolled, and how long the smooth scroll took to settle
- a CPU profile spans the scroll; the self-time table names the functions a
  hitch belongs to, readable on the dev server only, since the production
  bundle mangles names
- the dev-mode render instruments ride along (render count and ms per tick);
  they read zero on a production preview, where they are not armed
- `windowing` records the root's `data-windowing` attribute, so a row that
  measured an unwindowed document says so rather than reporting zero churn as
  a win

## Artifacts

- one `PERF-SCROLL` console line and one `perf-results/scroll-hitch-<row>.json`
  per row

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
