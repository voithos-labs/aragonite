import { describe, it, expect } from 'vitest';
import { scanInline } from '../../core/inline/scan';
import {
	autolinkNode,
	codeNode,
	describeScanCases,
	emphasisNode,
	entityNode,
	hardBreak,
	imageNode,
	linkNode,
	rawHtmlNode,
	strikethroughNode,
	textNode
} from './scan-test-helpers';

// GFM bare/www/email autolinks over text runs, ported from the old pipeline's
// links.ts §6.9 section — the old parser is the oracle (the reference has no
// autolink extension), except where a divergence is named inline.

describeScanCases('bare autolinks as the only content (fast-bail seam)', [
	// These inputs contain no unconditional special character: if the bail
	// probe misses its trigger, the autolink silently vanishes into plain text.
	[
		'https scheme probe (`://`)',
		'https://bare.example',
		[autolinkNode(0, 20, 'https://bare.example')]
	],
	['www prefix probe', 'www.example.com', [autolinkNode(0, 15, 'www.example.com')]],
	['email probe (`@`)', 'foo@bar.example.com', [autolinkNode(0, 19, 'mailto:foo@bar.example.com')]],
	['uppercase www prefix', 'WWW.Example.Com', [autolinkNode(0, 15, 'WWW.Example.Com')]]
]);

describeScanCases('recognition boundaries and trimming', [
	[
		'trailing punctuation trimmed',
		'Visit www.example.com.',
		[textNode(0, 6, 'Visit '), autolinkNode(6, 21, 'www.example.com'), textNode(21, 22, '.')]
	],
	[
		'unbalanced close paren trimmed',
		'www.example.com/a(b)c)',
		[autolinkNode(0, 21, 'www.example.com/a(b)c'), textNode(21, 22, ')')]
	],
	[
		'open paren is a valid leading boundary',
		'(www.x.com)',
		[textNode(0, 1, '('), autolinkNode(1, 10, 'www.x.com'), textNode(10, 11, ')')]
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
		'entity-shaped semicolon is kept',
		'www.x.com/&bogus08;',
		[autolinkNode(0, 19, 'www.x.com/&bogus08;')]
	]
]);

describeScanCases('urls stop where claimed constructs start', [
	[
		'entity reference ends the url',
		'https://x.com&amp;y',
		[autolinkNode(0, 13, 'https://x.com'), entityNode(13, 18, '&'), textNode(18, 19, 'y')]
	],
	[
		'code span ends the url',
		'https://x.com`c`',
		[autolinkNode(0, 13, 'https://x.com'), codeNode(13, 16, 'c')]
	],
	// The old pipeline absorbed the tag into the url; the single pass claims
	// it first, which is also GFM's stop-at-`<` rule (deliberate divergence).
	[
		'raw html tag ends the url',
		'https://x.y<br/>',
		[autolinkNode(0, 11, 'https://x.y'), rawHtmlNode(11, 16)]
	],
	// Same divergence for a following spec autolink (old absorbed `<…>`).
	[
		'spec autolink ends the url',
		'www.x.com<https://a.b>',
		[autolinkNode(0, 9, 'www.x.com'), autolinkNode(9, 22, 'https://a.b')]
	],
	// The old pipeline absorbed the backslash into the url and lost the
	// break; the in-scan hard-break claim wins (deliberate divergence).
	[
		'backslash hard break ends the url',
		'www.x.com\\\nfoo',
		[autolinkNode(0, 9, 'www.x.com'), hardBreak(9, 11), textNode(11, 14, 'foo')]
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
		[strikethroughNode(0, 13, [autolinkNode(2, 11, 'www.x.com')])]
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
	],
	[
		'autolink inside link text',
		'[see www.x.com](/u)',
		[linkNode(0, 19, [textNode(1, 5, 'see '), autolinkNode(5, 14, 'www.x.com')], '/u')]
	],
	[
		'autolink inside image alt structure',
		'![www.x.com](/u)',
		[imageNode(0, 16, [autolinkNode(2, 11, 'www.x.com')], 'www.x.com', '/u')]
	]
]);

describe('child walk under deep image nesting (DoS guard)', () => {
	it('pathological nesting parses without overflow and stays near-linear', () => {
		// 20k-deep `![…](u)` nesting — commonmark semantics build one image per
		// level, the class the old pipeline's bracket depth cap kept unreachable.
		// A per-level recursion in the autolink child walk overflows the call
		// stack here, and an unbounded dimension-suffix search over each level's
		// label goes quadratic. The generous bound fails both shapes on any
		// machine while leaving the linear one two orders of magnitude of room.
		const depth = 20000;
		const raw = '!['.repeat(depth) + 'a' + '](u)'.repeat(depth);
		const startedAt = performance.now();
		const nodes = scanInline(raw, 0, raw.length);
		const elapsed = performance.now() - startedAt;
		expect(elapsed).toBeLessThan(2000);
		expect(nodes).toHaveLength(1);
		// Iterative descent: a recursive assertion would itself overflow.
		let node = nodes[0];
		let imagesSeen = 0;
		while (node.kind === 'image') {
			imagesSeen++;
			expect(node.children).toHaveLength(1);
			node = node.children![0];
		}
		expect(imagesSeen).toBe(depth);
		expect(node).toEqual(textNode(depth * 2, depth * 2 + 1, 'a'));
	});
});
