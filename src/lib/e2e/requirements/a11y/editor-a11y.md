# Feature: Editor accessibility baseline (axe ratchet)

WCAG 2.1 AA is the target. axe runs over `.editor` across representative states;
any violation outside the committed baseline allowlist fails the gate.

## Happy paths

- Default multi-block content has no new (non-baselined) axe violations.
- Reading mode (`data-presentation='reading'`) has no new violations — the read-only
  surface (`contenteditable=false` + `aria-readonly`), CSS-hidden markers, synthesized
  bullets, and visible ordered numbers are all axe-relevant.
- Preview-block (`data-presentation='preview-block'`) has no new violations — focus-keyed
  marker hiding plus rendered bullet chrome on unfocused list items.
- Preview-inline (`data-presentation='preview-inline'`) has no new violations — the
  construct-marker stamps and folded/revealed spans get their own pass.
- An active cross-block selection exposes an ARIA live region announcing the span, and has no new violations.
- A keyboard block reorder (Alt+Arrow) announces the new position via a live region, and has no new violations.

## Edge cases (cross-wave states)

- The failed-block fallback (Wave 0.7.10.1) has no new violations.
- A blocked-scheme inert link (Wave 0.7.10.2) has no new violations.
