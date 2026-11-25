# Feature: A closing tag typed under an unclosed details

A `<details>` line and its `<summary>` line wait, read as HTML, until the line that closes them
arrives. Only `</details>` spelled exactly closes it, so a section forms on the closing tag's
last key and not before. Fixture: `<details>`, `<summary>Sum</summary>`, `Body`, with no closing
line, in the `/test/plugins?seed=details` harness. The caret goes to the end of `Body` by a click
and End, then Enter opens the line the tag is typed on, one key at a time.

## Happy paths

- `</details>` typed key by key: no section exists after any key before `>`, and `>` forms it.
  The summary stays `Sum` and the bytes are the opener, the summary, `Body`, a blank line and
  `</details>`. Source and live mode alike

## Edge cases

- `</DETAILS>` typed key by key stays HTML on every key, `>` included: only the exact spelling
  closes. Source and live mode alike

## Miss-analysis

- Every row with an unclosed opener loaded its closer or typed it whole, so no row saw the
  section form while the tag was still being typed, which wrote the `>` into the summary.
