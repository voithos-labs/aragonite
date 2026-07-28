# Feature: Fenced-code Enter-exit container scope

The closed-fence Enter-exit lands the new paragraph in the fence's OWN container
scope — the next sibling when one exists, else a paragraph minted in-scope — never
delegated outside the container. This unifies with the unclosed-fence auto-close and
the whole-block Enter tier: one Enter escapes one level, and a second Enter on the
minted empty paragraph breaks out of the container (the empty-trailing-line exit that
lists and quotes already share).

## Happy paths

- closed fence as a blockquote's last child, caret at display end, Enter: an empty paragraph is minted INSIDE the quote — the document keeps one top-level block (the quote), which gains a second child — and the caret lands on it
- closed-fence escape ladder: Enter (into the quote) then Enter (out of the quote via the empty-trailing break-out) then type: the paragraph sits after the quote, source byte-exact, parse converges
- unclosed-fence escape ladder: Enter (blank line in body) then Enter (auto-close mints the closer and a paragraph inside the quote) then Enter (out of the quote) then type: the paragraph sits after the quote, the closer is minted, parse converges

## Edge cases

- closed fence with a following sibling inside the quote, caret at display end, Enter: focus moves to the existing sibling in-scope and nothing is minted (the next-sibling landing is unchanged)
- closed fence at the document root, caret at display end, Enter: the paragraph is appended at root (in-scope is root already) — behavior unchanged from before the in-container fix
