# Feature: select-all over a document that is one container

Select-all (Ctrl+A twice) over a document that is one callout or one `<details>`, then a removal, keeps the container with its opening, emptied, as a range from the container's first byte that runs past its title row and stops before its closing line does. Live and source mode alike.

## Happy paths

- `:::tip Title`, an empty line, `:::`; select-all from the row, then Backspace, Delete or a cut: `:::tip `, an empty line, `:::`. A letter instead: `:::tip Q`. Enter: the same bytes as Backspace. Miss-analysis: every select-all row over a container had a body ending in text, so no row met a lone container whose last block is an empty line, where the range's end stepped back onto the row and the removal read the row held whole.
- The same document with no title (`:::tip`, an empty line, `:::`): select-all and Backspace leave it as it was.
- The same lone emptied callout in a quote, in a list item, and as a generic `:::foo`: the opening stays, `> :::tip `, `- :::tip `, `:::foo `.
- `<details open>`, `<summary>D</summary>`, a blank line, `x`, `</details>`; select-all from the body, then Backspace, Delete or a cut: `<details open>`, `<summary></summary>`, a blank line, `</details>`, which reads back as the same tree as the lone emptied details below, with the caret in the summary. A letter instead: the summary holds it. Miss-analysis: no row ran select-all over a lone `<details>` with a body, whose opening sits in the container's own bytes before its summary, where no row's write keeps it.
- The same details in a quote: the opening stays, the summary and the body empty.
- Each of these, cut and pasted back with Ctrl+V: the document comes back.

## Controls (today's answers, pinned)

- A lone callout with a body: `:::tip `, an empty line, `:::`.
- A lone emptied details (`<summary>D</summary>`, an empty body): the summary empties, the body's line stays.
- A callout then an empty line, with a body or without: the emptied callout and the empty lines after it stay.
- A callout then a paragraph, and a paragraph then a callout: the document empties.
- A lone emptied callout nested in a note: the inner box goes whole and the note stays, emptied (`::::note `, `::::`); Enter leaves an empty line in the note.
