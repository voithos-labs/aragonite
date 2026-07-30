# Feature: Plugin Container — `<details>` Collapsible

The `<details>` collapsible is the second reserved-chrome container consumer
(WS-B Cycle 2). It reserves child 0 as an editable `details-summary` chrome leaf
and stores its open/closed state as `{ open }` metadata that round-trips to the
`<details open>` / `<details>` opener bytes. Collapse is a windowing clamp: when
closed, only the summary row mounts and every body child genuinely unmounts.
This gate is behavioral — it asserts the CST read by path via `window.__test`,
the serialized bytes, and the mounted block-host count.

## Happy paths

- details renders as a component: the `?seed=details` route mounts the `DetailsBlock` (toggle + summary), not the raw-markdown fallback
- toggle collapses: clicking the disclosure toggle on an open details flips the opener bytes `<details open>` → `<details>`, drops `aria-expanded` to false, and unmounts every body child (only the summary block-host remains)
- toggle expands: clicking again flips `<details>` → `<details open>` and remounts the body
- summary edits round-trip: typing into the summary updates the `<summary>…</summary>` bytes with the chrome kind kept
- Enter-descend smoke: Enter at the end of an OPEN details' summary descends into the first body child (inherited chrome contract — a focus move, no split)

## Edge cases

- one undo restores both bytes and mount state: after a collapse toggle, a single Ctrl+Z flips the bytes back to `<details open>` AND remounts the body
- caret-in-body collapse: collapsing while the caret sits in a body child lands the caret on the summary (the clamp kills the pin, so the toggle commit's afterTick moves it)
- M3 — no invisible mint: Enter in a COLLAPSED, summary-only details is a no-op — the caret stays, nothing is minted, and no undo entry is pushed (a prior text edit undoes in one step)
- arrow-walk across a collapsed details: ArrowUp entering from the paragraph below lands the caret on the summary, never a silent no-op on the clamped-out last child
- horizontal walk into a collapsed details: ArrowLeft at the start of the paragraph below routes through `focus(CURSOR_END)` toward the unmounted last child and must clamp to the summary, never no-op on the absent ref
- vertical exit from a collapsed summary: ArrowDown in the collapsed summary delegates past the clamped-out body and lands on the paragraph below, never a silent dead-end on the unmounted ref
- horizontal exit from a collapsed summary: ArrowRight at the summary's end delegates past the clamped-out body to the paragraph below
- Backspace below a collapsed details: the cross-boundary merge walk stops at the summary chrome — the source stays byte-identical, nothing enters the hidden body, the block below stays visible, and the caret lands at the summary's END (typing appends after the summary text)
- Backspace below an OPEN details merges normally: the block below joins the last body child at the join point (the collapse probe never fires on an open container)
- cross-block copy ending mid-summary: drag-selecting from the prose above into the middle of the summary and copying synthesizes closer bytes — pasting below yields a second `details` carrying the truncated summary and the live open flag
- typing the terminator into a body child: typing `</details>` in a body paragraph commits as `&lt;/details>`, so the container survives, the block stays a paragraph, the line still reads `</details>` on screen, and the caret stays in that block

## User interactions

- click toggle / Ctrl+Z / Enter / arrow keys / typing / drag-select + copy + paste are real keystrokes and pointer events, each asserted against the CST by path, the serialized bytes, or the block-host count
- the disclosure toggle is a real keyboard-accessible `<button aria-expanded>`; a mouse toggle keeps the body caret (mousedown default suppressed) so the caret rule can observe it

## Error cases

- the `[invariant:…]` console watcher stays silent and `getCapturedErrors()` is empty across every gesture (opaque-container + state-consistency guards hold with the clamp active)
