# Feature: Plugin Container, `<details>` Collapsible

The `<details>` collapsible is the second container to reserve a child for its own title row. It
reserves child 0 as an editable `details-summary` leaf and stores its open/closed state as
`{ open }` metadata that round-trips to the `<details open>` / `<details>` opener bytes.
Collapsing is a windowing clamp: when the block is closed, only the summary row mounts and every
body child really does unmount. These checks read behavior: the tree read by path through
`window.__test`, the serialized bytes, and the number of mounted block hosts.

## Happy paths

- details renders as a component: the `?seed=details` route mounts the `DetailsBlock` (toggle plus summary), not the raw-markdown fallback
- toggle collapses: clicking the disclosure toggle on an open details flips the opener bytes `<details open>` to `<details>`, sets `aria-expanded` to false, and unmounts every body child, leaving only the summary's block host
- toggle expands: clicking again flips `<details>` back to `<details open>` and remounts the body
- summary edits round-trip: typing into the summary updates the `<summary>…</summary>` bytes and the child keeps its kind
- Enter descends: Enter at the end of an open details' summary moves focus into the first body child, the behavior every reserved title row inherits, and splits nothing

## Edge cases

- one undo restores both bytes and mount state: after a collapse toggle, a single Ctrl+Z flips the bytes back to `<details open>` and remounts the body
- caret in the body when it collapses: collapsing while the caret sits in a body child puts the caret on the summary, since the clamp unmounts the child the caret was in and the toggle commit's `afterTick` moves it
- M3, nothing is created invisibly: Enter in a collapsed, summary-only details does nothing. The caret stays, no node is created, and no undo entry is pushed, so an earlier text edit still undoes in one step
- arrow walk across a collapsed details: ArrowUp entering from the paragraph below puts the caret on the summary rather than doing nothing on the clamped-out last child
- sideways walk into a collapsed details: ArrowLeft at the start of the paragraph below goes through `focus(CURSOR_END)` toward the unmounted last child and has to clamp to the summary rather than do nothing on the missing reference
- vertical exit from a collapsed summary: ArrowDown in the collapsed summary passes the clamped-out body and lands on the paragraph below rather than stopping dead on the unmounted reference
- sideways exit from a collapsed summary: ArrowRight at the summary's end passes the clamped-out body and lands on the paragraph below
- Backspace below a collapsed details: the merge across the boundary stops at the summary row, the source stays byte-identical, nothing enters the hidden body, the block below stays visible, and the caret lands at the end of the summary, so typing appends after the summary text
- Backspace below an open details merges normally: the block below joins the last body child at the join point, since the collapsed-container check never fires on an open container
- cross-block copy ending mid-summary: drag-selecting from the prose above into the middle of the summary and copying builds the closing bytes the selection is missing, so pasting below yields a second `details` carrying the shortened summary and the current open flag
- typing the terminator into a body child: typing `</details>` in a body paragraph commits as `&lt;/details>`, so the container survives, the block stays a paragraph, the line still reads `</details>` on screen, and the caret stays in that block

## User interactions

- clicking the toggle, Ctrl+Z, Enter, the arrow keys, typing, and drag-select plus copy and paste are real keystrokes and pointer events, each asserted against the tree read by path, the serialized bytes, or the number of mounted block hosts
- the disclosure toggle is a real keyboard-accessible `<button aria-expanded>`; a mouse toggle keeps the caret in the body (the mousedown default is suppressed) so the caret rule can be observed

## Error cases

- the `[invariant:…]` console watcher stays silent and `getCapturedErrors()` is empty across every gesture, so the checks on opaque containers and on state consistency hold while the clamp is active
