import { describeScanCases, emphasisNode, rawHtmlNode, textNode } from './scan-test-helpers';

// Raw HTML (CommonMark §6.6) via the shared core/inline/html-tag-grammar.ts forms. `<`
// claims first in the single left-to-right pass, so nothing inside a tag can fragment it.

describeScanCases('tag forms', [
	['self-closing open tag', '<br/>', [rawHtmlNode(0, 5)]],
	['close tag', '</div>', [rawHtmlNode(0, 6)]],
	['comment', '<!-- c -->', [rawHtmlNode(0, 10)]],
	['processing instruction', '<?php x ?>', [rawHtmlNode(0, 10)]],
	['cdata', '<![CDATA[>&<]]>', [rawHtmlNode(0, 15)]],
	['unterminated comment stays text', '<!-- x', [textNode(0, 6, '<!-- x')]],
	['space after </ is not a close tag', '</ div>', [textNode(0, 7, '</ div>')]],
	['digit and underscore are not tag names', '<33> <__>', [textNode(0, 9, '<33> <__>')]]
]);

describeScanCases('tags claim ahead of inner constructs', [
	[
		'entity inside an attribute value',
		'foo <a href="&ouml;">',
		[textNode(0, 4, 'foo '), rawHtmlNode(4, 21)]
	],
	[
		'backslash inside an attribute value',
		'foo <a href="\\*">',
		[textNode(0, 4, 'foo '), rawHtmlNode(4, 17)]
	],
	[
		'bracket link tail inside an attribute value',
		'[foo <bar attr="](baz)">',
		[textNode(0, 5, '[foo '), rawHtmlNode(5, 24)]
	],
	[
		'backtick inside an attribute value leaves the outer backtick literal',
		'<a href="`">`',
		[rawHtmlNode(0, 12), textNode(12, 13, '`')]
	],
	[
		'delimiter inside an attribute value cannot pair',
		'a <b c="*">*x*',
		[textNode(0, 2, 'a '), rawHtmlNode(2, 11), emphasisNode(11, 14, [textNode(12, 13, 'x')])]
	]
]);

describeScanCases('declarations end at the first `>` — escapes do not reach inside', [
	// §2.4: backslash escapes do not work in raw HTML — a `\>` inside a declaration
	// must not be claimed as an escape, or the declaration ends at the wrong `>`.
	[
		'escape-lookalike inside a declaration',
		'x <!A \\> B>',
		[textNode(0, 2, 'x '), rawHtmlNode(2, 8), textNode(8, 11, ' B>')]
	],
	[
		'declaration with non-ascii and stray constructs',
		'[#é0<!b<)中b\\>>中<中𐄀`)',
		[textNode(0, 4, '[#é0'), rawHtmlNode(4, 13), textNode(13, 21, '>中<中𐄀`)')]
	]
]);
