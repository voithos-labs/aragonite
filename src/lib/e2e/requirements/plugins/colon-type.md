# Feature: a `:::` container a plugin value makes

A plugin value's block type on `colonLines` is read by the editor's own `:::` grammar, which
listing the type turns on. Driven on `/test/plugins?seed=asides`, where the value runs alone so
nothing else turns directives on, beside `/test/plugins?seed=admonitions`, where the old
registration's `:::tip` takes the same keys. Each row runs in live and source mode with real keys
and checks the bytes, the caret and the kind.

## Happy paths

- ArrowUp from the body's start: the title's start in live mode, byte 0 in source mode, on both pages
- A letter at a bare name's end (reached by ArrowLeft from the body): a space, then the letter, the kind kept
- The opening line holds the type's class and name (`aside-heading`, "Heading")

## Edge cases

- Backspace at the name's end: a generic box, the caret after the shortened name; the letter typed back: the type again, the caret after it
- `s` at `:::aside`'s end, where `asides` is a name another type of the value holds: the name grows into `:::asides`, the box takes that type and its row's class and name; `x` then starts its title

## User interactions

- The marker held (Shift+Home in live mode, Shift+ArrowRight over it in source mode) and Backspace: the box unwraps, the title over the body as paragraphs

## Miss-analysis

- Every `:::` spec ran on a page whose harness callout turned directives on, and no type a plugin
  value made reached a browser, so nothing showed the value bringing the grammar or its rows.
