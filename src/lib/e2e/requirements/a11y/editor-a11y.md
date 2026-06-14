# Feature: Editor accessibility baseline (axe ratchet)

WCAG 2.1 AA is the target. axe runs over `.editor` across representative states;
any violation outside the committed baseline allowlist fails the gate.

## Happy paths

- Default multi-block content has no new (non-baselined) axe violations.
- An active cross-block selection exposes an ARIA live region announcing the span, and has no new violations.

## Edge cases (cross-wave states)

- The failed-block fallback (Wave 0.7.10.1) has no new violations.
- A blocked-scheme inert link (Wave 0.7.10.2) has no new violations.
