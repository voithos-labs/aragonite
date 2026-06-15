# Feature: Latency attribution diagnostic

## Captures

- bridge sanity: a keystroke records ≥1 block render and ≥1 in-page sample.
- axis1 fan-out: renders-per-keystroke vs mounted block count (100/1000/5000). Flat ≈ no redundant re-render; scales → redundant (1a).
- axis3 cdp split: ScriptDuration vs LayoutDuration vs RecalcStyleDuration across N keystrokes at a fixed large block count.
- axis4 harness overhead: outer (harness) keystroke time vs in-page settle time; delta = polling/IPC.
- axis5 intra-block: keystroke p50 vs single-paragraph length (50KB/200KB/800KB).

## Notes

- All rows run serially (timing-sensitive). Dev server, DEV asserts active — upper bound on production.
- Block addressing uses CST indices via the `window.__test` bridge, never the chained DOM locator (minutes at thousands of hosts).
