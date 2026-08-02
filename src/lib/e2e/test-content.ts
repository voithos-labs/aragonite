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

// The `/test/editor` harness seed. Machine-facing: every construct the specs need to find,
// spelled out. The `/` showcase's own document is `routes/showcase-content.ts`.
export const HARNESS_SHOWCASE_CONTENT = `# aragonite — editor showcase

Every block type the editor parses. Edit freely; \`serialize(parse(source)) === source\` holds for shipped syntax.

## Headings

ATX uses \`# \` through \`###### \`. Setext:

Setext level 1
==============

Setext level 2
--------------

### ATX heading 3

## Inline

A paragraph with **bold**, *italic*, ~~strikethrough~~, and \`inline code\`. Inline links: [aragonite on GitHub](https://github.com). Hard line breaks via trailing backslash:\\
next line starts here.

Autolinks recognize bare URLs (https://example.com), bare \`www.\` URLs (www.commonmark.org), bare emails (hello@example.com), and angle-bracket forms (<https://commonmark.org>, <support@example.com>). Trailing sentence punctuation stays out of the link — visit https://example.com. (the period is text, not part of the URL). Mid-word triggers don't autolink: xhttps://example.com is plain text.

## Reference-style links and images

Three CommonMark §6.3 reference forms, each resolving against \`[label]: url\` definitions further down. Edit a definition and every reference updates on the next commit.

- **Full form:** [aragonite repo][repo] and [the docs][repo-docs].
- **Collapsed form:** [CommonMark spec][] (text doubles as the label).
- **Shortcut form:** [GFM] (bare brackets, no second pair needed; case-insensitive — note the definition is lowercase).

Image references support the same forms. Image-inside-link: [![Linked screenshot][shot]][repo]. Collapsed image: ![Mountains][]. Shortcut image: ![logo].

Unresolved references render as plain text — e.g. [this broken ref][nonexistent] stays literal because no \`[nonexistent]: url\` definition exists. Try adding one below to watch it resolve.

[repo]: https://github.com/voithos-labs/aragonite "aragonite on GitHub"
[repo-docs]: https://github.com/voithos-labs/aragonite/tree/main/docs
[CommonMark spec]: https://spec.commonmark.org/0.31.2/
[gfm]: https://github.github.com/gfm/ "GitHub Flavored Markdown spec"
[shot]: https://picsum.photos/seed/aragonite-shot/500/300 "Linked screenshot"
[mountains]: https://picsum.photos/seed/aragonite-ref-mountain/500/350
[logo]: https://picsum.photos/seed/aragonite-ref-logo/200/200

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

A blank line keeps a second paragraph inside the same item, and markers can mix as they nest:

1. First item, paragraph one.

   Still item one — an indented continuation paragraph in the same item.
2. Second item with a nested unordered sub-list:
   - mixed-marker child
   - another child
3. Third item.

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

## Nested containers

A blockquote wrapping a list:

> Quote intro paragraph.
>
> - quoted item one
> - quoted item two
>   - nested under a quoted item

List items can hold multiple blocks — here a blockquote, then a fenced code block:

- Item with a quote inside:

  > a blockquote nested in a list item

- Item with code inside:

  \`\`\`js
  const insideAListItem = true;
  \`\`\`

Three levels deep, alternating ordered and unordered:

1. Ordered level one
   - unordered level two
     1. ordered level three
2. Back to level one

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

Click an image to select it. Drag the corner or right-edge handles to resize, or press \`Shift+ArrowLeft\`/\`Shift+ArrowRight\` to step the width by 20px. Use the popover that appears to edit the URL, alt, or title. Backspace or Delete on a selected image deletes it.

Standalone image with a width hint:

![A photo|400](https://picsum.photos/seed/aragonite/600/400)

Explicit width × height:

![Square|200x200](https://picsum.photos/seed/aragonite-square/300/300)

With a title, and intentionally **no size hint** — a remote image with unknown dimensions reserves no height until it decodes, so this one is the live check that loading it (scroll past it, then back up) re-measures the block and holds the scroll position instead of jumping:

![Mountains](https://picsum.photos/seed/aragonite-mountain/500/350 "Click me — try the popover")

Mid-paragraph images render block-level even though the CST stores them inline:

Lorem ipsum dolor sit amet ![inline|180](https://picsum.photos/seed/aragonite-inline/240/180) consectetur adipiscing elit, sed do eiusmod tempor.

Inside a list item — the popover commit works in nested containers too:

- ![In a list|300](https://picsum.photos/seed/aragonite-list/400/300)
- Try selecting and editing this one.

Inside a table cell — falls back to alt-text-only since cells can't accommodate widget layout:

| Photo                                                              | Caption                                  |
| :----------------------------------------------------------------- | :--------------------------------------- |
| ![sunset](https://picsum.photos/seed/aragonite-sunset/120/80)      | Cell images render as alt text           |
| ![field](https://picsum.photos/seed/aragonite-field/120/80 "Field") | Title is preserved in raw, not displayed |

Broken image (404) — note the styled error state:

![This image fails to load](/test-fixtures/nonexistent.png)

## Inline HTML

CommonMark §6.6 inline HTML parses inside paragraphs. Most tags render as styled-literal source — \`<span class="hl">like this</span>\` — preserving the editor's always-visible-source philosophy.

The \`<br>\` tag is in the live allowlist: \`Line one<br>Line two\` produces an actual line break inside this paragraph: Line one<br>Line two.

Comments are preserved as styled-literal source: <!-- like this -->. Disallowed tags (GFM §6.11) like <script>alert(1)</script> render as literal source too — never executed, never rendered live.

## HTML block

<div class="note">
	HTML blocks round-trip verbatim.
</div>

---

End of showcase.
`;
