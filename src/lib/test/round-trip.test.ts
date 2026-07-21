import { describeRoundTrips } from '$lib/test/support/round-trip';

// ── Leaf Blocks ─────────────────────────────────────────────────────────────

describeRoundTrips('round-trip: leaf blocks', [
	{ name: 'single heading', source: '# Hello\n' },
	{
		name: 'heading levels',
		source: '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n'
	},
	{ name: 'heading with no trailing newline', source: '# Hello' },
	{ name: 'paragraph', source: 'Hello world.\n' },
	{ name: 'multi-line paragraph', source: 'Line one.\nLine two.\nLine three.\n' },
	{ name: 'heading then paragraph', source: '# Title\n\nSome body text.\n' },
	{ name: 'fenced code backticks', source: '```js\nconsole.log(1);\n```\n' },
	{ name: 'fenced code tildes', source: '~~~\ncode\n~~~\n' },
	{ name: 'fenced code 4 backticks', source: '````\ncode with ``` inside\n````\n' },
	{ name: 'unclosed fenced code', source: '```\ncode\nmore code\n' },
	{ name: 'thematic break ---', source: '---\n' },
	{ name: 'thematic break ***', source: '***\n' },
	{ name: 'thematic break ___', source: '___\n' },
	{ name: 'thematic break spaced', source: '- - -\n' },
	{ name: 'empty document', source: '' },
	{ name: 'only blank lines', source: '\n\n\n' },
	{ name: 'leading blank lines', source: '\n\n# Title\n' },
	{ name: 'trailing blank lines', source: '# Title\n\n\n' },
	{ name: 'multiple blank lines between blocks', source: '# A\n\n\n\n# B\n' },
	{ name: 'CRLF line endings', source: '# Title\r\n\r\nParagraph.\r\n' },
	{
		name: 'mixed content',
		source: '# Title\n\nParagraph text.\n\n```\ncode\n```\n\n---\n\nMore text.\n'
	}
]);

// ── Container Blocks ────────────────────────────────────────────────────────

describeRoundTrips('round-trip: blockquotes', [
	{ name: 'simple blockquote', source: '> Hello\n' },
	{ name: 'multi-line blockquote', source: '> Line 1\n> Line 2\n' },
	{ name: 'blockquote with heading', source: '> # Title\n' },
	{ name: 'blockquote with paragraph', source: '> Some text\n> continues here.\n' },
	{ name: 'blockquote then paragraph', source: '> Quote\n\nParagraph.\n' },
	{ name: 'nested blockquote', source: '> > Nested\n' },
	{ name: 'blockquote with blank inner line', source: '> \n> Content\n' },
	{ name: 'blockquote with code block', source: '> ```\n> code\n> ```\n' }
]);

describeRoundTrips('round-trip: lists', [
	{ name: 'unordered single item', source: '- Item\n' },
	{ name: 'unordered multiple items', source: '- A\n- B\n- C\n' },
	{ name: 'ordered list', source: '1. First\n2. Second\n' },
	{ name: 'ordered with paren', source: '1) A\n2) B\n' },
	{ name: 'task list', source: '- [ ] Todo\n- [x] Done\n' },
	{ name: 'plus marker', source: '+ Item\n' },
	{ name: 'star marker', source: '* Item\n' },
	{ name: 'list then paragraph', source: '- Item\n\nParagraph.\n' },
	{ name: 'multi-digit ordered', source: '10. Tenth\n11. Eleventh\n' },
	{ name: 'continuation line', source: '- Item\n  more text\n' },
	{ name: 'multi-paragraph item', source: '- Para 1\n\n  Para 2\n' },
	{ name: 'nested unordered list', source: '- Item 1\n  - Nested a\n  - Nested b\n- Item 2\n' },
	{ name: 'nested ordered in unordered', source: '- Item\n  1. First\n  2. Second\n' },
	{ name: 'deeply nested list', source: '- L1\n  - L2\n    - L3\n' },
	{ name: 'item with code block', source: '- Item\n  ```\n  code\n  ```\n' },
	{ name: 'item with blockquote', source: '- Item\n  > quote\n' },
	{ name: 'ordered with continuation', source: '1. Item\n   more text\n' }
]);

describeRoundTrips('round-trip: nested list edge cases', [
	{
		name: 'mixed nesting: list in blockquote',
		source: '> - Item 1\n> - Item 2\n'
	},
	{
		name: 'list after nested content in same item',
		source: '- Paragraph\n\n  - Nested\n\n- Next item\n'
	},
	{
		name: 'task item with continuation',
		source: '- [x] Line 1\n  Line 2\n'
	},
	{
		name: 'ordered nested in ordered',
		source: '1. Outer\n   1. Inner\n2. Next\n'
	},
	{
		name: 'empty item then nested content',
		source: '- \n  - Nested\n'
	},
	{
		name: 'item with indented code block',
		source: '- Item\n\n      code line\n'
	},
	{
		name: 'table inside list item',
		source: '- Item\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |\n'
	}
]);

// ── Setext, indented code, raw HTML, LRDs, tables ───────────────────────────

describeRoundTrips('round-trip: setext headings', [
	{ name: 'setext H1', source: 'Title\n===\n' },
	{ name: 'setext H2', source: 'Title\n---\n' },
	{ name: 'setext H1 long underline', source: 'Title\n==========\n' },
	{ name: 'setext H2 short underline', source: 'Title\n--\n' },
	{ name: 'setext with multi-line content', source: 'Line one\nLine two\n---\n' },
	{ name: 'setext then paragraph', source: 'Title\n===\n\nBody text.\n' },
	{ name: 'setext H1 after blank lines', source: '\nTitle\n===\n' },
	{ name: 'setext H2 trailing space on underline', source: 'Title\n--- \n' }
]);

describeRoundTrips('round-trip: indented code blocks', [
	{ name: 'single line', source: '    code line\n' },
	{ name: 'multiple lines', source: '    line 1\n    line 2\n' },
	{ name: 'tab indented', source: '\tcode line\n' },
	{ name: 'mixed indent', source: '    line 1\n\tline 2\n' },
	{ name: 'with blank line inside', source: '    line 1\n\n    line 2\n' },
	{ name: 'after paragraph', source: 'Paragraph.\n\n    code\n' },
	{ name: 'before paragraph', source: '    code\n\nParagraph.\n' },
	{
		// "100. " gives content indent 5, so the 4-space line exits the list
		name: 'indented code after list (top-level sibling)',
		source: '100. Item\n\n    code line\n'
	}
]);

describeRoundTrips('round-trip: inline raw HTML (CommonMark §6.6)', [
	{ name: 'inline <br>', source: 'Line one<br>Line two\n' },
	{ name: 'inline <br/> self-closing', source: 'Line one<br/>Line two\n' },
	{ name: 'inline <span> open + close', source: 'Hello <span class="hl">world</span>!\n' },
	{ name: 'inline comment mid-paragraph', source: 'Before <!-- a note --> after.\n' },
	{ name: 'inline HTML inside emphasis', source: '**bold <span>x</span> more**\n' },
	{ name: 'inline HTML inside code span stays literal', source: 'see `<br>` here\n' },
	{ name: 'multiple inline tags', source: '<span>a</span><br><span>b</span>\n' },
	{ name: '<br> inside table cell', source: '| H |\n| :- |\n| Left<br>Right |\n' }
]);

describeRoundTrips('round-trip: HTML blocks', [
	{ name: 'div block', source: '<div>\n  <p>Hello</p>\n</div>\n' },
	{ name: 'comment', source: '<!-- comment -->\n' },
	{ name: 'multiline comment', source: '<!--\n  comment\n-->\n' },
	{ name: 'pre block', source: '<pre>\ncode\n</pre>\n' },
	{ name: 'script block', source: '<script>\nalert(1);\n</script>\n' },
	{ name: 'self-closing', source: '<hr />\n' },
	{ name: 'html then paragraph', source: '<div>\nHello\n</div>\n\nParagraph.\n' },
	// §4.6 HTML-block conformance fixtures
	{ name: 'type 1: same-line close', source: '<script>foo</script>\n' },
	{
		name: 'type 1: multi-line with close + trailing paragraph',
		source: '<script>\nconsole.log(1);\n</script>\n\nafter\n'
	},
	{ name: 'type 1: textarea newly detected', source: '<textarea>\ntext\n</textarea>\n\nafter\n' },
	{ name: 'type 1: unclosed runs to EOF', source: '<script>\nfoo\n\nbar\n' },
	{ name: 'type 4: <!DOCTYPE> same-line close', source: '<!DOCTYPE html>\n\nafter\n' },
	{ name: 'type 5: CDATA', source: '<![CDATA[\nfoo\n]]>\n\nafter\n' },
	{ name: 'type 7: custom tag multi-line', source: '<custom-tag>\ncontent\n\nafter\n' },
	{
		name: 'type 7: custom tag with attributes',
		source: '<custom data-x="foo" data-y=\'bar\'>\ncontent\n\nafter\n'
	},
	{
		name: 'paragraph interrupt: <div> splits paragraph',
		source: 'Hello world\n<div>\ncontent\n\nafter\n'
	},
	{
		name: 'paragraph no-interrupt: type 7 stays in paragraph',
		source: 'Hello world\n<custom-tag>\ncontent\n'
	}
]);

describeRoundTrips('round-trip: link reference definitions', [
	{ name: 'basic', source: '[ref]: https://example.com\n' },
	{ name: 'with title double quotes', source: '[ref]: https://example.com "Title"\n' },
	{ name: 'with title single quotes', source: "[ref]: https://example.com 'Title'\n" },
	{ name: 'with title parens', source: '[ref]: https://example.com (Title)\n' },
	{ name: 'with angle bracket url', source: '[ref]: <https://example.com>\n' },
	{ name: 'multi-word label', source: '[my ref]: https://example.com\n' },
	{ name: 'after paragraph', source: 'Paragraph.\n\n[ref]: https://example.com\n' },
	{ name: 'multi-line: url on continuation', source: '[ref]:\n  https://example.com\n' },
	{
		name: 'multi-line: url + title on continuation',
		source: '[ref]:\n  https://example.com\n  "Title"\n'
	},
	{
		name: 'multi-line: url inline + title on continuation',
		source: '[ref]: https://example.com\n  "Title"\n'
	}
]);

describeRoundTrips('round-trip: tables', [
	{ name: 'simple table', source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n' },
	{
		name: 'table with all alignment variants',
		source: '| L | C | R | N |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |\n'
	},
	{
		name: 'table with tight delimiters',
		source: '|A|B|\n|:-|-:|\n|1|2|\n'
	},
	{
		name: 'table with escaped pipe in body cell',
		source: '| a | b |\n| --- | --- |\n| x | y \\| z |\n'
	},
	{
		name: 'table with escaped pipe in header cell',
		source: '| a \\| b | c |\n| --- | --- |\n| 1 | 2 |\n'
	},
	{
		name: 'header-only table',
		source: '| A | B |\n| --- | --- |\n'
	},
	{
		name: 'single-column table',
		source: '| A |\n| --- |\n| x |\n'
	},
	{ name: 'table then paragraph', source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nText.\n' },
	{
		name: 'table with CRLF line endings',
		source: '| A | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\n'
	},
	{
		name: 'table with empty cells',
		source: '| A | B |\n| --- | --- |\n|  |  |\n| 1 |  |\n'
	},
	{
		name: 'table with literal <br> in cell content (GFM line-break encoding)',
		source: '| A | B |\n| --- | --- |\n| line<br>two | x |\n'
	}
]);

// ── Inline Content ──────────────────────────────────────────────────────────

describeRoundTrips('round-trip: inline content', [
	{ name: 'paragraph with backslash escapes', source: 'foo \\*bar\\* baz\n' },
	{ name: 'paragraph with double backslash', source: 'foo \\\\* bar\n' },
	{ name: 'escape adjacent to code span', source: 'foo \\* `code` baz\n' },
	{ name: 'paragraph with named entity', source: 'copyright &copy; symbol\n' },
	{ name: 'paragraph with decimal numeric entity', source: 'apostrophe &#39; mark\n' },
	{ name: 'paragraph with hex numeric entity', source: 'quote &#x22; sign\n' },
	{ name: 'entity inside emphasis', source: '*&copy;*\n' },
	{ name: 'entity inside link text', source: '[&copy; me](https://example.com)\n' },
	{ name: 'entity inside code span (literal)', source: '`&copy;`\n' },
	{ name: 'invalid entity stays as text', source: 'this &notreal; survives\n' },
	{
		name: 'double-backtick code span containing a single backtick',
		source: 'Use ``a`b`` here.\n'
	}
]);

describeRoundTrips('round-trip: image dimensions', [
	{ name: 'basic image', source: '![cat](https://example.com/cat.png)\n' },
	{ name: 'image with width hint', source: '![cat|400](https://example.com/cat.png)\n' },
	{
		name: 'image with width x height hint and title',
		source: '![cat|400x300](https://example.com/cat.png "Cat photo")\n'
	},
	{
		name: 'image with surrounding paragraphs',
		source: 'Some intro text.\n\n![cat|400](https://example.com/cat.png)\n\nOutro text.\n'
	},
	{
		name: 'image mid-paragraph',
		source: 'A paragraph with ![inline|100](icon.png) image.\n'
	},
	{ name: 'image inside table cell', source: '| col |\n| --- |\n| ![cell-img](url) |\n' }
]);

describeRoundTrips('round-trip: autolinks', [
	{ name: 'bare email at sentence end', source: 'Email me at foo@bar.com.\n' },
	{ name: 'bare email mid-paragraph', source: 'see foo@bar.com please\n' },
	{ name: 'bare www. URL', source: 'visit www.example.com today\n' },
	{ name: 'bare www. with path', source: 'go to www.example.com/foo?a=1 now\n' },
	{ name: 'angle-bracket URL', source: 'see <https://example.com> here\n' },
	{ name: 'angle-bracket email', source: 'contact <foo@bar.com> please\n' },
	{ name: 'mixed http and email', source: 'see https://x.com or foo@bar.com\n' },
	{ name: 'http url with trailing period', source: 'visit https://example.com.\n' }
]);
