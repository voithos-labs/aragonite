# Feature: Fenced-code Enter-exit container scope

The closed-fence Enter-exit puts the new paragraph in the fence's own container:
the next sibling when one exists, otherwise a paragraph created inside that same
container, and never one handed outside it. This matches the unclosed-fence auto-close
and Enter on a whole block: one Enter leaves one level, and a second Enter on the new
empty paragraph leaves the container (the same empty-last-line exit that lists and
quotes already share).

## Happy paths

- closed fence as a blockquote's last child, caret at display end, Enter: an empty paragraph is created inside the quote, so the document keeps one top-level block (the quote), which gains a second child, and the caret lands on it
- closed-fence escape, one level per Enter: Enter (into the quote) then Enter (out of the quote via the empty-trailing break-out) then type: the paragraph sits after the quote, source byte-exact, parse converges
- unclosed-fence escape, one level per Enter: Enter (blank line in body) then Enter (auto-close writes the closer and a paragraph inside the quote) then Enter (out of the quote) then type: the paragraph sits after the quote, the closer is written, parse converges

## Edge cases

- closed fence with a following sibling inside the quote, caret at display end, Enter: focus moves to the existing sibling in the same container and nothing is created (the next-sibling landing is unchanged)
- closed fence at the document root, caret at display end, Enter: the paragraph is appended at the root, since the fence's container is the root already, and the behavior there is unchanged
