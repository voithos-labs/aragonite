# GFM Reference

Quick reference for the GitHub Flavored Markdown syntax Limestone's CST editor parses and renders. Section 1 covers standard CommonMark features, Section 2 covers GFM-specific extensions, Section 3 covers features widely seen on GitHub.com but outside the formal GFM specification. Sections 1 and 2 are the v1.0 scope; Section 3 is delivered as plugins on top of the v1.2 plugin API.

### 1. Standard Markdown Essentials (Included in GFM)

These are the core CommonMark features that GFM fully supports and builds upon.

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

```markdown
_Italic_ or _Italic_
**Bold** or **Bold**
**_Bold and Italic_**
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

**Reference-Style Links and Images:**

```markdown
Here is a [link to Google][google-ref] and another to [GitHub][github-ref].

[google-ref]: https://google.com 'Google Search'
[github-ref]: https://github.com
```

**Hard Line Breaks:**

```markdown
This is line one.\
This is line two directly below it.
```

**Thematic Breaks (Horizontal Rules):**

```markdown
---
---

---
```

**Indented Code Blocks:**

```markdown
    // Four spaces (or one tab) makes a code block
    function hello() {
        return "world";
    }
```

Note: Indented code blocks cannot interrupt a paragraph — there must be a blank line before them. Fenced code blocks (` ``` `) are generally preferred.

**HTML Blocks:**

```markdown
<div class="warning">
  <p>This is raw HTML embedded in markdown.</p>
</div>
```

CommonMark defines 7 types of HTML blocks based on opening tags. Block-level tags like `<div>`, `<table>`, `<pre>`, `<script>`, and HTML comments (`<!-- -->`) start HTML blocks. They continue until a blank line (for most types) or until their specific closing tag (for `<pre>`, `<script>`, `<style>`, `<textarea>`, and comments).

**Soft Line Breaks vs Hard Line Breaks:**

A regular newline within a paragraph is a "soft line break" — it is rendered as a space, not a visible line break:

```markdown
These two lines
become one paragraph.
```

A "hard line break" forces a visible `<br>`. There are two ways:

```markdown
Trailing backslash:\
Next line.

Two trailing spaces:
Next line.
```

**Setext Headings:**

```markdown
# Heading Level 1

## Heading Level 2
```

**Escaping Characters:**

```markdown
I literally want to type \*these asterisks\* without making the text italic.
```

---

### 2. Standard GFM Extensions

These are the formal extensions that distinguish GFM from plain CommonMark.

- **Task Lists:** Create interactive checkboxes.

```markdown
- [x] Completed task
- [ ] Incomplete task
```

- **Tables:** Organize data with columns and rows. Use colons to align text.

```markdown
| Left-aligned | Center-aligned | Right-aligned |
| :----------- | :------------: | ------------: |
| Row 1        |      Data      |          $100 |
| Row 2        |      Data      |          $200 |
```

- **Strikethrough:** Cross out text using double tildes.

```markdown
~~This text is crossed out~~
```

- **Autolinks:** Bare URLs and email addresses automatically turn into clickable links without needing angle brackets `< >` or standard link syntax.

```markdown
Visit https://github.com
Contact support@example.com
```

- **Disallowed Raw HTML:** Some raw HTML tags are treated as literal text rather than HTML. This is a specific GFM extension and is separate from GitHub's broader HTML sanitization rules.

---

### 3. GitHub.com Markdown Features

These are commonly supported on GitHub, but they are platform features rather than part of the official GFM specification.

- **Alerts (Admonitions):** Add distinctive styling to blockquotes to emphasize critical information. There are five supported types.

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

- **Footnotes:** GitHub supports clickable, numbered references at the bottom of a document.

```markdown
Here is a sentence that needs a citation[^1].

[^1]: This is the referenced footnote at the bottom of the page.
```

- **GitHub-Specific Autolinks:** GitHub automatically parses and links platform-specific references without extra markdown syntax.

```markdown
Mention a user or team: @username or @org/team
Reference an issue or Pull Request: #123
Reference a specific commit: a1b2c3d4e5f6 (typing the SHA automatically links it)
```

- **Collapsible Sections (HTML):** While technically HTML, this is commonly used on GitHub to keep long issue descriptions or PRs tidy. _(Note: You must leave a blank line after the `<summary>` tag for the nested Markdown to render correctly.)_

```html
<details>
	<summary>Click to expand</summary>

	This content is hidden by default. Standard **Markdown** works here!
</details>
```

- **Emoji Shortcodes:** GitHub parses standard emoji shortcodes wrapped in colons.

```markdown
I am feeling :smile: and :tada: today!
```

- **Relative Links:** Standard Markdown link destinations can already be relative, but GitHub resolves them naturally within a repository's file structure.

```markdown
[Read the Contributing Guide](./CONTRIBUTING.md)
[View the logo](../assets/logo.png)
```

- **Syntax Highlighting Aliases:** While you mentioned Fenced Code Blocks, it's worth noting that GFM relies on Linguist for syntax highlighting, which means it accepts hundreds of language identifiers and aliases.

```text
(e.g., using `js` or `javascript`, `py` or `python`, `sh` or `bash`)
```
