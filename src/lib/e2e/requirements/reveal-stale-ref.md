# Feature: Reveal into a stale top-level ref slot

A top-level block that scrolls out of the render window can leave a detached
component ref in its slot (the windowed each-block's cleanup is conditional by
design). A reveal targeting that block must detect the stale slot, drop it, and
scroll the block back into the window — never descend into the detached ref.
The stale slot is forged deterministically through the test-probe capture /
re-plant pair, because the natural cleanup race is not reproducible on demand.

## Happy paths

- Ctrl+F for text unique to the stale-slotted block: the editor scrolls back, the block mounts, and the active match overlay is visible.

## Edge cases

- The scrolled-out block's slot clears on unmount (precondition the probes assert before forging the stale ref).
