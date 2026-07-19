# Feature: Virtual rendering — measure batching (VR-4)

On a fling, many blocks mount in one animation frame. The per-block
measure-then-mutate path must not force one synchronous reflow per mounted block —
mount measurement rides the scope's batched read-all-then-write pass. The honest
signal is layouts-per-mount, read via CDP `LayoutCount` (real-browser only — jsdom
reports zero layout, so the unit suite can't catch the regression).

## Measure batching (VR-4)

- A fling does not force one reflow per mounted block: flinging ~1 viewport per animation frame through a multi-thousand-block doc mounts hundreds of hosts, but forced synchronous reflows (CDP `LayoutCount`) stay an order of magnitude below the mount count — layouts-per-mount well under 0.3, vs the ~1.0 of the un-batched mount path. Mount measurement rides the scope's read-all-then-write batch; the per-block re-measure effect (BlockHost `measureNow` / TableRowBlock `measureRowNow`) must skip its mount run and fire only on a subsequent edit. Real-browser only — jsdom reports zero layout, so the unit suite can't catch the regression.
- A fling does not force one reflow per mounted table row (table path): rows aren't `BlockHost`s, so the block-path guard (no-table fixture) never exercises TableRowBlock's mount-run skip — reverting only that skip leaves it green. Flinging through a giant windowed table (thousands of rows) mounts hundreds of rows but keeps layouts-per-mount well under 0.3, vs the ~1.0 of the un-skipped path: TableRowBlock's `measureRowNow` edit effect skips its mount run, so the per-row cell read doesn't interleave with the prior row's subtotal write; the table scope's batched read-all-then-write pass owns mount measurement. Counted via `[data-table-row-idx]` mounts and bracketed with CDP `LayoutCount`. Real-browser only.

## Error cases

- No page errors surface during the fling.
