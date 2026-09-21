# Feature: Editor accessibility baseline (axe ratchet)

WCAG 2.1 AA is the target. axe runs over `.editor` across representative states;
any violation outside the committed baseline allowlist fails the gate.

## Happy paths

- Default multi-block content has no new (non-baselined) axe violations.
- Reading mode (`data-presentation='reading'`) has no new violations: the read-only
  editable area (`contenteditable=false` plus `aria-readonly`), the markers CSS hides,
  the synthesized bullets and the visible ordered numbers all matter to axe.
- Preview-block (`data-presentation='preview-block'`) has no new violations: marker
  hiding keyed on focus, plus rendered bullet markers on unfocused list items.
- Preview-inline (`data-presentation='preview-inline'`) has no new violations: the data
  attributes on construct markers, and the spans whose markers are hidden or shown, get
  their own pass.
- The live-mode link card has no new violations while open. It sits inside `.editor`, so
  its dialog role and name, its labelled field and its named buttons are covered by the same `include('.editor')` scan.
- An active cross-block selection exposes an ARIA live region announcing the span, and has no new violations.
- A keyboard block reorder (Alt+Arrow) announces the new position via a live region, and has no new violations.

## Edge cases (cross-wave states)

- The failed-block fallback (Wave 0.7.10.1) has no new violations.
- A blocked-scheme inert link (Wave 0.7.10.2) has no new violations.
