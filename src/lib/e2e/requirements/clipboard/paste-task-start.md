# Clipboard: a block pasted at the start of a to-do's text

A to-do's checkbox sits on its first line, so whatever lands at the start of its text is read the way a reload reads that whole line. A block the bare bullet can hold (a heading, a quote) takes the text's place, and the to-do gives its box up. A block the bare bullet can't hold stays the to-do's text instead, the same as typing it there would.

## Happy paths

- `- [ ] bc`, caret before `b`, paste `---`: the source is `- [ ] ---\n  bc\n`, still a to-do, and a reload reads the same tree. (`- ---` on its own line is a divider, which would end the list.)
- `- [ ] bc`, caret before `b`, paste `# h`: the source is `- # h\n  bc\n`, a plain item holding a heading, and a reload agrees.

## Miss-analysis

- GH #669: the to-do paste rows only ever landed blocks a bare bullet holds, so no row pasted a line that reads as a divider once the box goes, where the to-do turned into a divider on reload.
