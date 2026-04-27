export const DEFAULT_CONTENT = `# Heading 1

## Heading 2

### Heading 3

A paragraph with **bold text**, *italic text*, ~~strikethrough~~, and \`inline code\`.

Another paragraph with a [link](https://example.com) and plain text.

---

> A blockquote paragraph.
>
> Second blockquote paragraph with **bold**.

- Item one
- Item two
  - Nested item
- Item three

1. First
2. Second
3. Third

\`\`\`javascript
const x = 42;
console.log(x);
\`\`\`

A final paragraph.
`;

export const SIMPLE_CONTENT = `First paragraph.

Second paragraph.

Third paragraph.
`;

export const SHOWCASE_CONTENT = `# Limestone — editor showcase

Every block type the editor parses. Edit freely; \`serialize(parse(source)) === source\` holds for shipped syntax.

## Headings

ATX uses \`# \` through \`###### \`. Setext:

Setext level 1
==============

Setext level 2
--------------

### ATX heading 3

## Inline

A paragraph with **bold**, *italic*, ~~strikethrough~~, and \`inline code\`. Links: [Limestone on GitHub](https://github.com). Bare URLs autolink: https://example.com. Hard line breaks via trailing backslash:\\
next line starts here.

## Escapes & entities

Backslash escapes neutralize the next punctuation: \\*not italic\\*, \\[not a link\\], \\\`not code\\\`. Use \\\\ for a literal backslash.

HTML entities pass through: &copy; 2026 — em-dash &mdash;, non-break&nbsp;space, decimal &#39;apostrophe&#39;, hex &#x22;quote&#x22;.

## Lists

- Unordered one
- Unordered two
  - Nested item
- Unordered three

1. Ordered first
2. Ordered second
3. Ordered third

## Task lists

- [x] Completed — click to toggle
- [ ] Pending
- [X] Uppercase \`[X]\` parses as checked; toggling canonicalizes to \`[x]\`

## Blockquotes

> Blockquote with **emphasis**.
>
> Multi-paragraph content stays inside the quote.
>
> > Nested blockquote.

## Code

Fenced with syntax highlighting:

\`\`\`javascript
function greet(name) {
	return \`Hello, \${name}!\`;
}
\`\`\`

Indented (4-space) code blocks also parse:

    function indented() {
        return 'still works';
    }

## Tables

| Left     | Center   |    Right |
| :------- | :------: | -------: |
| Column A | Column B | Column C |
| Row two  | data     |     $100 |

Shortcuts when focus is inside a cell (Mac: \`Cmd\` for any \`Ctrl\`):

| Action                    | Shortcut                    |
| :------------------------ | :-------------------------- |
| Hop to next / prev cell   | \`Tab\` / \`Shift+Tab\`         |
| Cell below (or new row)   | \`Enter\`                     |
| Insert row below / above  | \`Ctrl+Enter\` / \`Ctrl+Shift+Enter\` |
| Insert column right / left | \`Alt+Shift+→\` / \`Alt+Shift+←\` |
| Delete current row        | \`Ctrl+Shift+Backspace\`      |
| Delete current column     | \`Alt+Shift+Backspace\`       |
| Cycle column alignment    | \`Ctrl+Shift+A\`              |
| Select cell / table / doc | \`Ctrl+A\` (1st / 2nd / 3rd press) |

## Images

![Alt text for a placeholder image](https://example.com/sample.png)

## HTML block

<div class="note">
	HTML blocks round-trip verbatim.
</div>

---

End of showcase.
`;
