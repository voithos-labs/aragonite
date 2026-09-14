# Feature: the ```math fence's delimiters in live mode

The fenced `math` form renders through the same render-primary component as `$$…$$`, so its
revealed source owes the same chrome: the opening and closing fence lines are marker furniture
that live mode hides, and the edit range clamps to the body between them. Without that chrome the
fence bytes read as body text — they paint in live mode, and a delete reaches them.

Fixture: `Before` / a ```math fence / `After` (`?seed=mathfence`), in `live`.

## Happy paths

- the revealed source keeps its bytes while the fence lines paint nothing on screen
- select-all then Backspace empties the body alone, and the blur commits the fence intact

## Edge cases

- a delete one step in from the leading edge lands in the body, never on the opener

## Miss-analysis

- The fence's only interactive spec drove it in source mode, where every marker paints and a
  fence line is landable by design, so no scenario ever asked a marker-hiding rung what the
  fence looks like or what a delete beside it may touch.
