import { describeRoundTrips } from '#lib/test/harness/round-trip.js';

// Source shapes no arm of the round-trip property's generators draws (invariants/arbitraries/gfm.ts
// and raw-string.ts). Every shape they do draw is that property's to check.

describeRoundTrips('round-trip: leaf blocks the generators do not draw', [
	{ name: 'heading with trailing spaces', source: '# Title   \n' },
	{ name: '7 hashes is not a heading', source: '####### Not a heading\n' },
	{ name: 'fence with trailing space on opener', source: '```  \ncode\n```\n' },
	{ name: 'fenced code 4 backticks around ```', source: '````\ncode with ``` inside\n````\n' },
	{ name: 'tilde fence close must match character', source: '```\ncode\n~~~\nmore code\n```\n' },
	{ name: 'blockquote no space after >', source: '>text\n' },
	{ name: 'setext H1 long underline', source: 'Title\n==========\n' },
	{ name: 'setext H2 short underline', source: 'Title\n--\n' },
	{ name: 'setext H2 trailing space on underline', source: 'Title\n--- \n' }
]);

describeRoundTrips('round-trip: list markers the generators do not draw', [
	{ name: 'ordered with paren', source: '1) A\n2) B\n' },
	{ name: 'multi-digit ordered', source: '10. Tenth\n11. Eleventh\n' },
	{
		// "100. " gives content indent 5, so the 4-space line exits the list
		name: 'indented code after list (top-level sibling)',
		source: '100. Item\n\n    code line\n'
	},
	{ name: 'empty item', source: '- \n' },
	{ name: 'empty item then nested content', source: '- \n  - Nested\n' },
	{ name: 'task item uppercase [X]', source: '- [X] upper\n' },
	{ name: 'task item multi-space variant', source: '- [x]  extra\n' }
]);

describeRoundTrips('round-trip: HTML blocks', [
	{ name: 'div block', source: '<div>\n  <p>Hello</p>\n</div>\n' },
	{ name: 'comment', source: '<!-- comment -->\n' },
	{ name: 'multiline comment', source: '<!--\n  comment\n-->\n' },
	{ name: 'pre block', source: '<pre>\ncode\n</pre>\n' },
	{ name: 'script block', source: '<script>\nalert(1);\n</script>\n' },
	{ name: 'self-closing', source: '<hr />\n' },
	{ name: 'html then paragraph', source: '<div>\nHello\n</div>\n\nParagraph.\n' },
	{ name: 'html block after heading with no blank line', source: '# T\n<div>\nContent\n</div>\n' },
	{ name: 'indented code then html block', source: '    code\n\n<div>\nhtml\n</div>\n' },
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

describeRoundTrips('round-trip: multi-line link reference definitions', [
	{ name: 'url on continuation', source: '[ref]:\n  https://example.com\n' },
	{
		name: 'url + title on continuation',
		source: '[ref]:\n  https://example.com\n  "Title"\n'
	},
	{
		name: 'url inline + title on continuation',
		source: '[ref]: https://example.com\n  "Title"\n'
	}
]);

describeRoundTrips('round-trip: table spellings the generators do not draw', [
	{
		name: 'all alignment variants',
		source: '| L | C | R | N |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |\n'
	},
	{ name: 'tight delimiters', source: '|A|B|\n|:-|-:|\n|1|2|\n' },
	{
		name: 'escaped pipe in body cell',
		source: '| a | b |\n| --- | --- |\n| x | y \\| z |\n'
	},
	{
		name: 'escaped pipe in header cell',
		source: '| a \\| b | c |\n| --- | --- |\n| 1 | 2 |\n'
	}
]);
