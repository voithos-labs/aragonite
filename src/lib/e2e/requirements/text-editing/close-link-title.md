# Feature: typing a link title's closing quote

A link definition's title can start on the line below it (`[a]: /u` over `"x"`). Until its closing
quote is typed, that line is just a paragraph, so the quote is what turns the two blocks into one.
The editor has to see that as you type, the same way a reload would.

## Happy paths

- `[a]: /u\n"x\n`, a real click into the paragraph, Ctrl+End, then a typed `"`: the source is `[a]: /u\n"x"\n`, one block, and a reload reads the same tree. One more typed character lands right after the quote, inside what's now the definition.
- `[a]: /u\n"x\nmore\n`, the same at the end of `more`: the source is `[a]: /u\n"x\nmore"\n`, the definition with a two-line title, and the next character lands after the quote too.

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss-analysis

- GH #622: a keystroke that keeps its block's kind skips asking its neighbours, and the only case pinned against that skip was a list above, whose reach depends on the first line's indent. No case put a block that reads the lines below it over the one being typed in.
