# GFM Reference

Every piece of GFM syntax this editor handles, on one page, so you don't have to keep a spec tab open while working out whether some construct is our problem. Three sections:

1. [Standard Markdown essentials](#1-standard-markdown-essentials): the CommonMark core that GFM builds on.
2. [Standard GFM extensions](#2-standard-gfm-extensions): the formal extensions that make GFM its own dialect.
3. [GitHub.com Markdown features](#3-githubcom-markdown-features): what GitHub renders beyond the formal spec.

Sections 1 and 2 are the core, handled by the editor itself and in scope for 1.0. Section 3 is mostly plugins:

- Alerts, diagrams, math, footnotes, collapsible sections and emoji shortcodes ship as bundled plugins (`@voithos-labs/aragonite/plugins/<name>`; each entry below names its plugin), written against the same API a third-party plugin gets.
- Syntax-highlighting aliases are the built-in code block's job.
- Relative links aren't a syntax. The embedding app resolves them through the `resolveLinkUrl` prop, a function that takes the URL as written and returns the one the link should open.
- GitHub-specific autolinks (`#123`, `@user`, bare commit SHAs) are left out on purpose, since they resolve against a repo the editor doesn't own ([plugin-contract.md § Explicitly excluded](../design/plugin-contract.md) has the ruling).

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

GFM spec §6.8: an absolute URI in angle brackets, any valid scheme, is a link, no `[text](url)` needed. (Bare URLs with no brackets at all are the Section 2 extension.)

**Line Breaks:**

A regular newline inside a paragraph is a soft line break. GitHub renders it as a space; here you see the line break where you typed it.

```markdown
These two lines
become one paragraph.
```

A hard line break forces a visible break (a `<br>` in GitHub's output). Two spellings, a trailing backslash or two trailing spaces, and the editor takes both:

```markdown
This is line one.\
This is line two directly below it.
```

The two-trailing-spaces spelling can't be shown faithfully here, because formatters (this repo's included) strip trailing whitespace. Which is also a decent reason to prefer the visible backslash.

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

One catch: an indented code block can't interrupt a paragraph (a blank line has to come first), which is part of why most people reach for fences instead.

**HTML Blocks:**

```markdown
<div class="warning">
  <p>This is raw HTML embedded in markdown.</p>
</div>
```

CommonMark defines 7 types of HTML block by opening tag. Block-level tags like `<div>`, `<table>`, `<pre>`, `<script>`, and HTML comments (`<!-- -->`) start one. Most types run until a blank line; `<pre>`, `<script>`, `<style>`, `<textarea>` and comments run until their own closing tag. The editor doesn't render any of it as HTML; an HTML block shows as its source, in a monospace editable box.

**Inline Raw HTML:**

```markdown
This paragraph contains <span class="hl">inline tags</span> and a <br /> hard break.
HTML comments like <!-- ignored --> and processing instructions <?php ?> are also recognized.
```

GFM spec §6.10 recognizes six forms inside a paragraph and passes them through to the page: open tags, close tags, comments, processing instructions, declarations, and CDATA sections. The editor recognizes the same six, each as one unit, so nothing inside a tag gets read as Markdown; but it shows them as source text rather than rendering them. The one tag it does render is `<br>` (and `<br />`), as a line break. The Disallowed Raw HTML extension (Section 2) is GitHub escaping a small dangerous subset back to literal text.

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

The full HTML5 named-entity set plus decimal (`&#NNN;`) and hexadecimal (`&#xNNNN;`) numeric references are recognized (GFM spec §6.2). A recognized reference renders as its glyph, and the caret treats it as one character: arrows step over it, and a Backspace beside it removes the whole reference. One that decodes to nothing visible stays as source text. Either way a reference is one unit, and so is a backslash escape, so neither can turn into an emphasis marker or leak into a link.

---

### 2. Standard GFM Extensions

- **Task Lists:** Checkboxes, clickable here too; a click flips the `[ ]` / `[x]` in the source (inert in reading mode).

```markdown
- [x] Completed task
- [ ] Incomplete task
```

- **Tables:** Columns and rows; colons in the delimiter row set the column alignment, and the cells follow it here as on GitHub.

```markdown
| Left-aligned | Center-aligned | Right-aligned |
| :----------- | :------------: | ------------: |
| Row 1        |      Data      |          $100 |
| Row 2        |      Data      |          $200 |
```

- **Strikethrough:** Cross out text with tildes. A run of one or two tildes delimits (`~single~` and `~~double~~` both strike, matching cmark-gfm, GitHub's reference implementation); a run of three or more stays literal, and mixed lengths never pair (a one-tilde opener doesn't close a two-tilde run).

```markdown
~~This text is crossed out~~
~Also crossed out~
```

- **Autolinks (GFM spec §6.9):** Bare URLs, `www.` addresses and emails turn into links with no angle brackets and no `[text](url)`.

```markdown
Visit https://github.com or www.github.com
Contact support@example.com
```

The editor follows the extension's rules. Here they are anyway, since they're the ones people trip on:

- **`www.` scheme insertion.** A `www.` URL carries no scheme, so `http` is inserted into the link target while the visible text stays verbatim: `www.example.com` links to `http://www.example.com`. (`http`/`https` URLs keep their own scheme; emails prepend `mailto:`.)
- **Valid domain.** The host is dot-separated segments of letters, digits, `_`, and `-`, with one enforced rule: no underscore may appear in either of the last two segments, so `www.xxx._yyy.zzz` stays literal while `www._xxx.yyy.zzz` links. A bare `www.` with nothing after it stays literal too.
- **Leading boundary.** A bare autolink begins only at the start of the region or after whitespace or one of `*`, `_`, `~`, `(`, so `xhttps://x` and `a/foo@bar.com` stay literal.
- **Trailing punctuation.** A trailing `?`, `!`, `.`, `,`, `:`, `*`, `_`, or `~` is left out of the link (`visit https://example.com.` keeps the period as text). A trailing `)` is excluded only when the URL holds more `)` than `(`, so a wiki link like `…/Foo_(bar)` keeps its parenthesis.
- **Entity-shaped tail.** A trailing `;` stays in the URL unless the tail is shaped like an entity reference (`&`, then one or more alphanumerics, then `;`), in which case the whole `&…;` is excluded: `www.google.com/search?q=commonmark&hl;` links only `…?q=commonmark`.

- **Disallowed Raw HTML:** A handful of raw HTML tags (`<script>`, `<title>`, `<iframe>` and friends) are treated as literal text rather than HTML. It's a formal GFM extension, separate from GitHub's much broader HTML sanitization. Here it's moot, because the editor renders no inline tag except `<br>` in the first place (see Inline Raw HTML above).

---

### 3. GitHub.com Markdown Features

- **Alerts (Admonitions):** Blockquotes with a type tag on the first line get distinctive styling. The bundled admonitions plugin renders them as styled callouts and keeps the `> [!NOTE]` syntax rather than rewriting it to `:::note`. Five types:

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

- **Mathematical Expressions:** GitHub supports LaTeX-style math in some Markdown contexts. Here it's the bundled latex plugin, all three forms below.

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

One divergence, on purpose: a `$` followed straight away by a digit is currency, not math, so `$5` and `$5 and $10` stay literal text. Only the opener is guarded, so `$x^2$` still closes on its `2`.

- **Mermaid Diagrams:** A fenced code block tagged `mermaid` renders as a diagram. The bundled mermaid plugin does the rendering, with the `mermaid` package as an optional peer dependency.

````markdown
```mermaid
graph TD;
    A-->B;
    A-->C;
```
````

- **Footnotes:** Numbered references. GitHub collects the definitions at the bottom of the page; the bundled footnotes plugin leaves each one where you wrote it, numbers by first reference, and jumps between reference and definition on the activation click (Ctrl/Cmd+click while editing, a plain click in reading mode).

```markdown
Here is a sentence that needs a citation[^1].

[^1]: This is the referenced footnote at the bottom of the page.
```

- **GitHub-Specific Autolinks:** GitHub links platform references with no markdown syntax at all. These are the ones the intro left out; nothing but GitHub can resolve them.

```markdown
Mention a user or team: @username or @org/team
Reference an issue or Pull Request: #123
Reference a specific commit: a1b2c3d4e5f6 (typing the SHA automatically links it)
```

- **Collapsible Sections (HTML):** Technically raw HTML, but common on GitHub for keeping long issue descriptions tidy. On GitHub, leave a blank line after the `<summary>` line or the Markdown inside won't render. The bundled details plugin opens these as a real collapsible block, but only in the canonical shape: `<details>` (or `<details open>`) on its own line, `<summary>…</summary>` unindented on the next, `</details>` on its own line at the end. Anything looser falls back to a plain HTML block (GitHub is fine with an indented `<summary>`, the plugin isn't), and a body line indented past the blank line turns into indented code, on GitHub as much as here.

```html
<details>
<summary>Click to expand</summary>

This content is hidden by default. Standard **Markdown** works here!
</details>
```

- **Emoji Shortcodes:** Standard emoji shortcodes wrapped in colons. The bundled emoji plugin swaps each one for its glyph, off GitHub's own gemoji table.

```markdown
I am feeling :smile: and :tada: today!
```

- **Relative Links:** Standard link destinations can already be relative; GitHub resolves them against the repository's file tree. Here the embedding app does that, through `resolveLinkUrl` (see the intro).

```markdown
[View the logo](../assets/logo.png)
```

- **Syntax Highlighting Aliases:** GitHub leans on Linguist for highlighting, so a fence's language tag accepts hundreds of identifiers and aliases. The editor's code block does the same with highlight.js's grammars and their aliases, read off the first token of the info string (`js {1-3}` still highlights as JavaScript).

```text
(e.g., using `js` or `javascript`, `py` or `python`, `sh` or `bash`)
```
