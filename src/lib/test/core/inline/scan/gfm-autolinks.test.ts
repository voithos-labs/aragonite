import { defaultGrammarView } from '$lib/schema/block-openers';
import { describe, it, expect } from 'vitest';
import { scanInline } from '../../../../core/inline/scan';
import {
	autolinkNode,
	codeNode,
	describeScanCases,
	emphasisNode,
	entityNode,
	hardBreak,
	rawHtmlNode,
	strikethroughNode,
	textNode
} from './scan-test-helpers';

// GFM §6.9 autolinks. The conformance reference has no autolink extension, so these
// shapes are pinned here rather than by the ratchet.

describeScanCases('bare autolinks as the only content (fast-bail seam)', [
	// These inputs contain no unconditional special character: if the bail
	// probe misses its trigger, the autolink silently vanishes into plain text.
	[
		'https scheme probe (`://`)',
		'https://bare.example',
		[autolinkNode(0, 20, 'https://bare.example')]
	],
	['www prefix probe', 'www.example.com', [autolinkNode(0, 15, 'http://www.example.com')]],
	['email probe (`@`)', 'foo@bar.example.com', [autolinkNode(0, 19, 'mailto:foo@bar.example.com')]],
	['uppercase www prefix', 'WWW.Example.Com', [autolinkNode(0, 15, 'http://WWW.Example.Com')]]
]);

describeScanCases('recognition boundaries and trimming', [
	[
		'trailing punctuation trimmed',
		'Visit www.example.com.',
		[textNode(0, 6, 'Visit '), autolinkNode(6, 21, 'http://www.example.com'), textNode(21, 22, '.')]
	],
	[
		'unbalanced close paren trimmed',
		'www.example.com/a(b)c)',
		[autolinkNode(0, 21, 'http://www.example.com/a(b)c'), textNode(21, 22, ')')]
	],
	[
		'trailing matched paren pair is kept',
		'www.x.com/a_(b)',
		[autolinkNode(0, 15, 'http://www.x.com/a_(b)')]
	],
	['a dotless www stays text', 'www x', [textNode(0, 5, 'www x')]],
	[
		'open paren is a valid leading boundary',
		'(www.x.com)',
		[textNode(0, 1, '('), autolinkNode(1, 10, 'http://www.x.com'), textNode(10, 11, ')')]
	],
	['bracket is not a valid leading boundary', '[www.x.com]', [textNode(0, 11, '[www.x.com]')]],
	[
		// ASCII case-folding is for letters only: 0x0E | 0x20 collides with `.`
		// (the `*` defeats the fast bail so the matcher itself is exercised).
		'control character is not a dot in the www prefix',
		'*www' + String.fromCharCode(0x0e) + 'x.com',
		[textNode(0, 10, '*www' + String.fromCharCode(0x0e) + 'x.com')]
	],
	['word character before the scheme rejects', 'xhttps://a.b', [textNode(0, 12, 'xhttps://a.b')]],
	['dotless email domain rejects', 'x@y', [textNode(0, 3, 'x@y')]],
	[
		'a mailto: prefix joins the email link',
		'at mailto:a@b.co.',
		[textNode(0, 3, 'at '), autolinkNode(3, 16, 'mailto:a@b.co'), textNode(16, 17, '.')]
	],
	[
		// The earlier address ends at `xmpp`, so the later prefix would begin inside that link.
		'a prefix never reaches back into the link before it',
		'mailto:a@b.co_x_xmpp:c@d.co',
		[autolinkNode(0, 20, 'mailto:a@b.co_x_xmpp'), textNode(20, 27, ':c@d.co')]
	],
	[
		'an xmpp: prefix joins the email link with its resource',
		'xmpp:a@b.co/r x',
		[autolinkNode(0, 13, 'xmpp:a@b.co/r'), textNode(13, 15, ' x')]
	],
	[
		// GFM §6.9: a trailing `&…;` resembling an entity reference is excluded
		// from the url (the `&` and everything after), landing as sibling text.
		'entity-shaped semicolon is excluded',
		'www.x.com/&bogus08;',
		[autolinkNode(0, 10, 'http://www.x.com/'), textNode(10, 19, '&bogus08;')]
	]
]);

describeScanCases('urls stop where claimed constructs start', [
	[
		'entity reference ends the url',
		'https://x.com&amp;y',
		[autolinkNode(0, 13, 'https://x.com'), entityNode(13, 18, '&'), textNode(18, 19, 'y')]
	],
	// The same rule as the `&amp;` row, so a fix to one cannot skip the other.
	[
		'named entity ends the url',
		'https://x.com&copy;y',
		[autolinkNode(0, 13, 'https://x.com'), entityNode(13, 19, '©'), textNode(19, 20, 'y')]
	],
	[
		'code span ends the url',
		'https://x.com`c`',
		[autolinkNode(0, 13, 'https://x.com'), codeNode(13, 16, 'c')]
	],
	// The scan takes the tag or spec autolink before the url pass ever reaches it.
	[
		'raw html tag ends the url',
		'https://x.y<br/>',
		[autolinkNode(0, 11, 'https://x.y'), rawHtmlNode(11, 16)]
	],
	[
		'spec autolink ends the url',
		'www.x.com<https://a.b>',
		[autolinkNode(0, 9, 'http://www.x.com'), autolinkNode(9, 22, 'https://a.b')]
	],
	// The hard-break claim wins over url continuation, so the break survives
	// instead of the backslash being absorbed into the destination.
	[
		'backslash hard break ends the url',
		'www.x.com\\\nfoo',
		[autolinkNode(0, 9, 'http://www.x.com'), hardBreak(9, 11), textNode(11, 14, 'foo')]
	]
]);

// Miss-analysis: every `<` case here was a tag or spec autolink, never a `<` that stays text.
describeScanCases('a `<` ends the url even where it stays text (§6.9)', [
	[
		'spec example: the www url stops at the `<`',
		'www.commonmark.org/he<lp',
		[autolinkNode(0, 21, 'http://www.commonmark.org/he'), textNode(21, 24, '<lp')]
	],
	[
		'the scheme url stops at the `<`',
		'http://a.com/x<y z',
		[autolinkNode(0, 14, 'http://a.com/x'), textNode(14, 18, '<y z')]
	],
	[
		'trailing punctuation before the `<` is still trimmed',
		'www.x.com/a.<b',
		[autolinkNode(0, 11, 'http://www.x.com/a'), textNode(11, 14, '.<b')]
	],
	[
		'an unbalanced paren before the `<` is still trimmed',
		'www.x.com/a)<b',
		[autolinkNode(0, 11, 'http://www.x.com/a'), textNode(11, 14, ')<b')]
	],
	[
		'a paren after the `<` does not balance one before it',
		'www.x.com/a)<(',
		[autolinkNode(0, 11, 'http://www.x.com/a'), textNode(11, 14, ')<(')]
	],
	[
		'a url that is only a scheme before the `<` stays text',
		'http://<a',
		[textNode(0, 9, 'http://<a')]
	],
	[
		'the email domain stops at the `<`',
		'a@b.co<x',
		[autolinkNode(0, 6, 'mailto:a@b.co'), textNode(6, 8, '<x')]
	],
	[
		'an xmpp resource stops at the `<`',
		'xmpp:a@b.co/r<x',
		[autolinkNode(0, 13, 'xmpp:a@b.co/r'), textNode(13, 15, '<x')]
	]
]);

describeScanCases('autolinks interleave with emphasis and links', [
	[
		'emphasis wraps around a url',
		'*https://x.y*',
		[emphasisNode(0, 13, [autolinkNode(1, 12, 'https://x.y')])]
	],
	[
		'strikethrough wraps around a url',
		'~~www.x.com~~',
		[strikethroughNode(0, 13, [autolinkNode(2, 11, 'http://www.x.com')])]
	],
	[
		'interior delimiter is url content, trailing one pairs',
		'*https://x.y/a*b*',
		[emphasisNode(0, 17, [autolinkNode(1, 16, 'https://x.y/a*b')])]
	],
	[
		'delimiter run consumed by an email cannot pair',
		'_a@b.c',
		[autolinkNode(0, 6, 'mailto:_a@b.c')]
	]
]);

describe('child walk under deep image nesting (DoS guard)', () => {
	it('pathological nesting parses without overflow and stays near-linear', () => {
		// A per-level recursion in the autolink child walk overflows the call stack here. The
		// wall clock is a coarse backstop only; core/inline/image-dimensions.test.ts is exact.
		const depth = 20000;
		const raw = '!['.repeat(depth) + 'a' + '](u)'.repeat(depth);
		const startedAt = performance.now();
		const nodes = scanInline(raw, 0, raw.length, undefined, defaultGrammarView);
		const elapsed = performance.now() - startedAt;
		expect(elapsed).toBeLessThan(2000);
		expect(nodes).toHaveLength(1);
		// Conditional throws, not 20k expect() calls: a recursive assertion would itself
		// overflow, and the per-call overhead would dominate the timing above.
		let node = nodes[0];
		let imagesSeen = 0;
		while (node.kind === 'image') {
			imagesSeen++;
			if (node.children?.length !== 1) {
				throw new Error(`image at depth ${imagesSeen} has ${node.children?.length} children`);
			}
			node = node.children[0];
		}
		expect(imagesSeen).toBe(depth);
		expect(node).toEqual(textNode(depth * 2, depth * 2 + 1, 'a'));
	});
});
