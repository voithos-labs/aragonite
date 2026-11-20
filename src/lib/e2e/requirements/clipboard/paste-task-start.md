# Clipboard: a block pasted at the start of a to-do's text

A paste puts bytes at the caret and takes nothing the user didn't select, so one line pasted at the start of a to-do's text goes in as text beside the box, the way a reload reads the to-do's whole line and the same as typing it there. A box stands in front of text and nothing else (GFM task lists), so a block of more than one line that is not text (a table, a code block) takes the text's place in the bullet, and the to-do gives its box up.

## Happy paths

- `- [ ] bc`, caret before `b`, paste `---`: the source is `- [ ] ---\n\n  bc\n`, still a to-do, and a reload reads the same tree. The pasted line stays a line of its own: with no blank line a reload would read `bc` into it. (`- ---` on its own line is a divider, which would end the list.)
- `- [ ] bc`, caret before `b`, paste `# h`: the source is `- [ ] # hbc\n`, still a to-do with its box, the `# h` text beside it, and a reload agrees.
- `- [x] z`, `- [ ] alpha`, `- [x] c`, caret before `alpha`, paste a code block: the code block stands in the middle item's bullet with `alpha` under it, the box gone, the list still one list of three items, and a reload agrees.

## Miss-analysis

- GH #669: the to-do paste rows only ever landed blocks a bare bullet holds, so no row pasted a line that reads as a divider once the box goes, where the to-do turned into a divider on reload.
- The rows that pasted a block of lines read "the item gives its checkbox up" as the item giving way, and no row had text left after the caret, so a to-do parted its list and a code block stood behind the box as text.
