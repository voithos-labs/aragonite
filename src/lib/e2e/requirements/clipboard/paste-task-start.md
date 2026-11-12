# Clipboard: a block pasted at the start of a to-do's text

A paste puts bytes at the caret and takes nothing the user didn't select, so a to-do keeps its checkbox whatever lands at the start of its text. The pasted line is read the way a reload reads the to-do's whole line, which is as text beside the box, the same as typing it there.

## Happy paths

- `- [ ] bc`, caret before `b`, paste `---`: the source is `- [ ] ---\n\n  bc\n`, still a to-do, and a reload reads the same tree. The pasted line stays a line of its own: with no blank line a reload would read `bc` into it. (`- ---` on its own line is a divider, which would end the list.)
- `- [ ] bc`, caret before `b`, paste `# h`: the source is `- [ ] # hbc\n`, still a to-do with its box, the `# h` text beside it, and a reload agrees.

## Miss-analysis

- GH #669: the to-do paste rows only ever landed blocks a bare bullet holds, so no row pasted a line that reads as a divider once the box goes, where the to-do turned into a divider on reload.
