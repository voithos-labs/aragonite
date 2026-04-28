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

Wide table (overflows horizontally — scroll inside the table to see all columns):

| Quarter | Region | Country | Sales Channel | Product Family | SKU       | Currency | Units Sold | Gross Revenue | Discounts | Net Revenue | Cost of Goods | Gross Margin | Margin % | Returns Count | Returns Value | Net After Returns | Lead Source | Sales Cycle (days) | Account Manager | Renewal Risk | NPS Trend | Notes                      | Last Sync (UTC)        |
| :------ | :----- | :------ | :------------ | :------------- | :-------- | :------- | ---------: | ------------: | --------: | ----------: | ------------: | -----------: | -------: | ------------: | ------------: | ----------------: | :---------- | -----------------: | :-------------- | :----------- | :-------- | :------------------------- | :--------------------- |
| Q1 2026 | EMEA   | DE      | Direct        | Atlas          | ATL-100   | EUR      |      1,240 |       $98,400 |    $4,920 |     $93,480 |       $52,300 |      $41,180 |    44.0% |            42 |        $2,103 |           $91,377 | Inbound     |                 27 | A. Patel        | Low          | ↑ +6      | Renewal due 2026-04-12     | 2026-04-25T10:14:02Z   |
| Q1 2026 | NA     | US      | Partner       | Beacon         | BCN-220   | USD      |      2,815 |      $211,125 |   $12,667 |    $198,458 |      $109,420 |      $89,038 |    44.9% |           112 |        $5,610 |          $192,848 | Partner     |                 19 | M. Chen         | Medium       | ↔ flat    | Mid-market expansion play  | 2026-04-25T10:14:02Z   |
| Q2 2026 | APAC   | JP      | Reseller      | Cipher         | CPH-301   | JPY      |        980 |       $73,500 |    $2,205 |     $71,295 |       $48,540 |      $22,755 |    31.9% |            18 |        $1,440 |           $69,855 | Outbound    |                 41 | R. Hernandez    | High         | ↓ -3      | Pricing pushback in trial  | 2026-04-25T10:14:02Z   |
| Q2 2026 | EMEA   | FR      | Direct        | Drift          | DRF-014   | EUR      |      1,602 |      $128,160 |    $7,689 |    $120,471 |       $69,830 |      $50,641 |    42.0% |            41 |        $3,212 |          $117,259 | Inbound     |                 22 | A. Patel        | Low          | ↑ +4      | Procurement still pending  | 2026-04-25T10:14:02Z   |
| Q3 2026 | LATAM  | BR      | Direct        | Echo           | ECH-555   | BRL      |        744 |       $52,080 |    $2,604 |     $49,476 |       $30,990 |      $18,486 |    37.4% |            16 |          $880 |           $48,596 | Outbound    |                 33 | L. Okafor       | Medium       | ↔ flat    | Pilot extended one quarter | 2026-04-25T10:14:02Z   |

## Images

![Alt text for a placeholder image](https://example.com/sample.png)

## HTML block

<div class="note">
	HTML blocks round-trip verbatim.
</div>

---

End of showcase.
`;
