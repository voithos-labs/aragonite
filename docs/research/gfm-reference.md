# GFM Reference

Every piece of GFM syntax this editor parses and renders, on one page, so you never have to keep a spec tab open while working out whether some construct is our problem or not. Three sections:

1. [Standard Markdown essentials](#1-standard-markdown-essentials): the CommonMark core that GFM builds on.
2. [Standard GFM extensions](#2-standard-gfm-extensions): the formal extensions that make GFM its own dialect.
3. [GitHub.com Markdown features](#3-githubcom-markdown-features): what GitHub renders beyond the formal spec.

Sections 1 and 2 are the v1.0 core scope: the parser handles them natively. Section 3 is where the plugin platform shows:

- Alerts, diagrams, math, footnotes, collapsible sections and emoji shortcodes all ship today as bundled plugins, built on the same authoring API a third party gets.
- Syntax-highlighting aliases ride the built-in code-block highlighter.
- Relative links are the embedding app's concern rather than a syntax: link resolution goes through the `resolveLinkUrl` prop.
- GitHub-specific autolinks (`#123`, `@user`, bare commit SHAs) are deliberately excluded, since they resolve against a repo the editor does not own ([plugin-contract.md § Explicitly excluded](../design/plugin-contract.md)).

<!-- Examples demonstrating alternative syntaxes use `text` fences on purpose:
     prettier formats `markdown`-tagged fences as markdown and normalizes away
     the very variants being shown (emphasis markers, ***/___ breaks, setext
     underlines, trailing-space hard breaks). Do not retag them. -->

### 1. Standard Markdown Essentials

**Headings:**

```markdown
# H1 (Title)

## H2

### H3
```

**Paragraphs:**

```markdown
This is one paragraph.

This is a second paragraph.
```

**Emphasis:**

```text
*Italic* or _Italic_
**Bold** or __Bold__
***Bold and Italic***
```

**Lists:**

```markdown
- Unordered item 1
- Unordered item 2
  - Nested item (indent with 2 spaces)

1. Ordered item 1
2. Ordered item 2
```

**Links and Images:**

```markdown
[Link Text](https://example.com)
![Image Alt Text](https://example.com/image.jpg)
```

**Blockquotes:**

```markdown
> This is a blockquote.
> It can span multiple lines.
```

**Inline Code:**

```markdown
Use single backticks for `inline code` or commands.
```

**Fenced Code Blocks:**

````markdown
```javascript
function helloWorld() {
	console.log('Hello!');
}
```
````

Tilde fences (`~~~`) are equivalent, and handy when the snippet itself contains backticks.

**Reference-Style Links and Images:**

```markdown
Here is a [link to Google][google-ref] and another to [GitHub][github-ref].

[google-ref]: https://google.com 'Google Search'
[github-ref]: https://github.com
```

**Autolinks (Angle Brackets):**

```markdown
Visit <https://example.com> or write to <mailto:user@example.com>.
```

Per the GFM spec §6.8, an absolute URI in angle brackets, any valid scheme, becomes a link without `[text](url)` syntax. (The bare-URL kind, no brackets at all, is the Section 2 extension.)

**Line Breaks:**

A regular newline inside a paragraph is a soft line break: it renders as a space, not a visible break.

```markdown
These two lines
become one paragraph.
```

A hard line break forces a visible `<br>`. Two spellings, a trailing backslash or two trailing spaces:

```markdown
This is line one.\
This is line two directly below it.
```

The two-trailing-spaces spelling works identically but cannot be shown faithfully here: formatters (this repo's included) strip trailing whitespace. Which is also the reason to prefer the visible backslash.

**Thematic Breaks (Horizontal Rules):**

```text
---
***
___
```

**Indented Code Blocks:**

```markdown
    // Four spaces (or one tab) makes a code block
    function hello() {
        return "world";
    }
```

One catch: an indented code block cannot interrupt a paragraph (a blank line must come before it), which is part of why fenced blocks are generally preferred.

**HTML Blocks:**

```markdown
<div class="warning">
  <p>This is raw HTML embedded in markdown.</p>
</div>
```

CommonMark defines 7 types of HTML block by opening tag. Block-level tags like `<div>`, `<table>`, `<pre>`, `<script>`, and HTML comments (`<!-- -->`) start one. Most types run until a blank line; `<pre>`, `<script>`, `<style>`, `<textarea>` and comments run until their own closing tag.

**Inline Raw HTML:**

```markdown
This paragraph contains <span class="hl">inline tags</span> and a <br /> hard break.
HTML comments like <!-- ignored --> and processing instructions <?php ?> are also recognized.
```

Per the GFM spec §6.10, six tag forms are recognized inside paragraphs and pass through to the rendered output: open tags, close tags, comments, processing instructions, declarations, and CDATA sections. The Disallowed Raw HTML extension (Section 2) escapes a small dangerous subset back to literal text.

**Setext Headings:**

```text
Heading Level 1
===============

Heading Level 2
---------------
```

**Escaping Characters:**

```markdown
I literally want to type \*these asterisks\* without making the text italic.
```

**Entity & Character References:**

```markdown
Named: &nbsp; &copy; &mdash;
Decimal: &#35; &#1234;
Hexadecimal: &#x22; &#xE9;
```

The full HTML5 named-entity set plus decimal (`&#NNN;`) and hexadecimal (`&#xNNNN;`) numeric references are recognized in inline content (GFM spec §6.2). The editor's inline scanner handles them at the `&`, next to backslash escapes at the `\`, so neither can pair as an emphasis delimiter or leak into link syntax.

---

### 2. Standard GFM Extensions

- **Task Lists:** Interactive checkboxes.

```markdown
- [x] Completed task
- [ ] Incomplete task
```

- **Tables:** Columns and rows; colons in the delimiter row set the alignment.

```markdown
| Left-aligned | Center-aligned | Right-aligned |
| :----------- | :------------: | ------------: |
| Row 1        |      Data      |          $100 |
| Row 2        |      Data      |          $200 |
```

- **Strikethrough:** Cross out text with tildes. A run of one or two tildes delimits (`~single~` and `~~double~~` both strike, matching cmark-gfm, GitHub's reference implementation); a run of three or more stays literal, and mixed lengths never pair (a one-tilde opener does not close a two-tilde run).

```markdown
~~This text is crossed out~~
~Also crossed out~
```

- **Autolinks (GFM spec §6.9):** Bare URLs, `www.` addresses and emails turn into links with no angle brackets and no `[text](url)`.

```markdown
Visit https://github.com or www.github.com
Contact support@example.com
```

Recognition follows the GFM extension rules. What the editor's autolink pass enforces, rule by rule:

- **`www.` scheme insertion.** A `www.` URL carries no scheme, so `http` is inserted into the link target while the visible text stays verbatim: `www.example.com` links to `http://www.example.com`. (`http`/`https` URLs keep their own scheme; emails prepend `mailto:`.)
- **Valid domain.** The host is dot-separated segments of letters, digits, `_`, and `-`, with one enforced rule: no underscore may appear in either of the last two segments, so `www.xxx._yyy.zzz` stays literal while `www._xxx.yyy.zzz` links. A bare `www.` with nothing after it stays literal too.
- **Leading boundary.** A bare autolink begins only at the start of the region or after whitespace or one of `*`, `_`, `~`, `(`, so `xhttps://x` and `a/foo@bar.com` stay literal.
- **Trailing punctuation.** A trailing `?`, `!`, `.`, `,`, `:`, `*`, `_`, or `~` is left out of the link (`visit https://example.com.` keeps the period as text). A trailing `)` is excluded only when the URL holds more `)` than `(`, so a wiki link like `…/Foo_(bar)` keeps its parenthesis.
- **Entity-shaped tail.** A trailing `;` stays in the URL unless the tail is shaped like an entity reference (`&`, then one or more alphanumerics, then `;`), in which case the whole `&…;` is excluded: `www.google.com/search?q=commonmark&hl;` links only `…?q=commonmark`.

- **Disallowed Raw HTML:** A handful of raw HTML tags are treated as literal text rather than HTML. This is a formal GFM extension, separate from GitHub's much broader HTML sanitization.

---

### 3. GitHub.com Markdown Features

- **Alerts (Admonitions):** Blockquotes with a type tag on the first line get distinctive styling. Five types:

```markdown
> [!NOTE]
> Highlights information that users should take into account, even when skimming.

> [!TIP]
> Optional information to help a user be more successful.

> [!IMPORTANT]
> Crucial information necessary for users to succeed.

> [!WARNING]
> Critical content demanding immediate user attention due to potential risks.

> [!CAUTION]
> Negative potential consequences of an action.
```

- **Mathematical Expressions:** GitHub supports LaTeX-style math in some Markdown contexts.

```markdown
Inline math uses a single dollar sign:
$e^{i\pi} + 1 = 0$

Block math uses double dollar signs:

$$
\left( \sum_{k=1}^n a_k b_k \right)^2 \leq \left( \sum_{k=1}^n a_k^2 \right) \left( \sum_{k=1}^n b_k^2 \right)
$$
```

Block math has a third form: a fenced code block whose info string's first token is `math`.

````markdown
```math
x^2 + y^2 = z^2
```
````

The editor's inline `$…$` recognizer is digit-guarded on the opener: a `$` immediately followed by a digit stays currency, so `$5` and `$5 and $10` render as literal text rather than math. This is a deliberate divergence. The close is not digit-guarded, so `$x^2$` still closes on its `2`.

- **Mermaid Diagrams:** A fenced code block tagged `mermaid` renders as a diagram.

````markdown
```mermaid
graph TD;
    A-->B;
    A-->C;
```
````

- **Footnotes:** Clickable, numbered references collected at the bottom of the document.

```markdown
Here is a sentence that needs a citation[^1].

[^1]: This is the referenced footnote at the bottom of the page.
```

- **GitHub-Specific Autolinks:** GitHub links platform references with no markdown syntax at all. (These are the ones the intro excluded: nothing but GitHub can resolve them.)

```markdown
Mention a user or team: @username or @org/team
Reference an issue or Pull Request: #123
Reference a specific commit: a1b2c3d4e5f6 (typing the SHA automatically links it)
```

- **Collapsible Sections (HTML):** Technically raw HTML, but common on GitHub for keeping long issue descriptions tidy. Leave a blank line after the `<summary>` tag or the nested Markdown inside will not render.

```html
<details>
	<summary>Click to expand</summary>

	This content is hidden by default. Standard **Markdown** works here!
</details>
```

- **Emoji Shortcodes:** Standard emoji shortcodes wrapped in colons.

```markdown
I am feeling :smile: and :tada: today!
```

- **Relative Links:** Standard link destinations can already be relative; GitHub resolves them against the repository's file tree.

```markdown
[View the logo](../assets/logo.png)
```

- **Syntax Highlighting Aliases:** GitHub leans on Linguist for highlighting, so a fence's language tag accepts hundreds of identifiers and aliases. The editor's built-in highlighter resolves aliases the same way.

```text
(e.g., using `js` or `javascript`, `py` or `python`, `sh` or `bash`)
```
