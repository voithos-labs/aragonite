# Feature: Latency attribution diagnostic

## Captures

- bridge sanity: a keystroke records ≥1 block render and ≥1 in-page sample.
- axis1 fan-out: renders-per-keystroke vs mounted block count (100/1000/5000). Flat ≈ no redundant re-render; scales → redundant (1a).
- axis3 cdp split: ScriptDuration vs LayoutDuration vs RecalcStyleDuration across N keystrokes at a fixed large block count.
- axis4 harness overhead: outer (harness) keystroke time vs in-page settle time; delta = polling/IPC.
- axis5 intra-block: keystroke p50 vs single-paragraph length (50KB/200KB/800KB).
- axisN nested headline: harness p50 vs in-page p50, block-render count/total, and the CDP script/layout/recalc split over 20 keystrokes on a 1MB nested-containers document.
- axisM which blocks: one keystroke's block-render paths bucketed by top-level subtree and by depth (total, distinct, edited-block renders, top renderers). Records the fan-out shape; asserts only that paths were captured.
- axisP per-keystroke distribution: renders, in-page ms and harness ms for six consecutive keystrokes — the spread the p50 rows hide.
- axisQ steady-state cdp: task/script/layout/recalc per keystroke over 15 keystrokes, after a warm-up keystroke absorbs the one-time full-document re-render.
- axisR steady-state instruments: renders, parse count/ms/blocks, inline computes, snapshots and rebuild depths per keystroke, post-warmup.
- axisS flat block count: steady-state p50, in-page p50, CDP script per keystroke, mounted top-level hosts and renders-per-keystroke at 1000/10000/30000 uniform blocks.
- axisLoad flat load: load ms, top-level child count vs mounted host count, renders during load, and the script/layout split at 1MB/4MB/10MB of many small blocks. Separates first-render-mounts-all from O(count) materialization.
- axisI container interior: harness p50, in-page p50, CDP script/layout/recalc per keystroke and the instrument snapshot (rebuild depths, parses, snapshots, block renders, coverage reads) for 10 keystrokes at the head leaf and again at a mid leaf of a 1MB single list, no prose target prepended. The one caret position no other row here takes: inside the container rather than ahead of it.
- axisT first edit: the full instrument profile of the FIRST keystroke after load. The one row with a pin — block renders ≤ 50, since a document-wide fan-out reads in the tens of thousands.

## Notes

- All rows run serially (timing-sensitive). Dev server, DEV asserts active — upper bound on production.
- Block addressing uses CST indices via the `window.__test` bridge, never the chained DOM locator (minutes at thousands of hosts).
