# Feature: a pathological regex query cannot freeze the editor

A regex with catastrophic backtracking (`(a+)+$` against a few dozen characters that
fail to match) spends minutes inside a single `RegExp.exec`. No main-thread budget
can interrupt one exec, so regex scans run off the main thread under a hard deadline
and the worker is terminated when it overruns. Literal search is unaffected: it stays
synchronous.

Only the browser exercises this. The unit runner has no `Worker`, so it takes the
synchronous fallback, where one runaway exec is unbounded by construction.

Scenarios use a fixture holding a short editable paragraph plus a block whose text
makes the pattern backtrack catastrophically.

## Happy paths

- a pathological pattern typed into the find bar: the editor keeps accepting input,
  and the query's own scan ends in a reported state rather than a hang

## Edge cases

- typing into the document while the pathological scan is running: the keystroke
  reaches the document within a bounded wait (the freeze regression is this never
  landing)
- the deadline overrun: the count readout carries the error presentation and reads
  "Regex too slow", and no match overlay is painted
- recovery after an overrun: replacing the query with a cheap pattern clears the
  too-slow state and matches again, so the bar is not wedged

## Error cases

- the overrun raises no page error: the terminated scan is a handled state, never an
  unhandled rejection
