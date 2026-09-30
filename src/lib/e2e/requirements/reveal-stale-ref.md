# Feature: Reveal into a stale top-level ref slot

A top-level block that scrolls out of the render window can leave a detached
component reference behind at its position (the cleanup in the windowed each
block is conditional by design). Scrolling to that block must detect the stale
reference, drop it, and bring the block back into the window rather than descend
into the detached one. The stale reference is created deterministically through
the test probes' capture and re-plant pair, because the natural cleanup race
cannot be reproduced on demand.

## Happy paths

- Ctrl+F for text unique to the stale-slotted block: the editor scrolls back, the block mounts, and the active match overlay is visible.

## Edge cases

- The scrolled-out block's position clears on unmount (a precondition the probes assert before creating the stale reference).
