# Feature: a letter typed in a code fence, timed on two builds

The perf a/b probe types into a 60-line JavaScript fence at the end of its last line, in live mode,
on a build with the highlight package listed and on one without it, so a key in a fence costs what
it did before the highlighting moved out of the core.

## Happy paths

- sixty letters typed at the end of the fence's last line, each timed until the block holds it:
  the row reports the samples and their p50 and p95
