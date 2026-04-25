# Feature: Code Block — Electric Indent

Enter between an empty bracket pair expands into three lines with one extra indent on the cursor line.

## Electric indent

- Enter between an empty opener/closer pair (`(|)`, `[|]`, `{|}`) expands into three lines: the opener line, an extra-indented middle line where the cursor lands, and the closer line at the original indent
- Quote pairs (`"|"`, `'|'`, `` `|` ``) do NOT trigger electric indent — they stay inline
- The extra indent level is one tab character (matching the Tab key's behavior)
