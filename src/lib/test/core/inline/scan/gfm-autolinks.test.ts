import { describe, it, expect } from 'vitest';
import { scanInline } from '../../../../core/inline/scan';
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

// GFM §6.9 bare/www/email autolinks over text runs. The reference has no
// autolink extension, so these shapes are pinned here rather than by the
// conformance ratchet.

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
	[
		'code span ends the url',
		'https://x.com`c`',
		[autolinkNode(0, 13, 'https://x.com'), codeNode(13, 16, 'c')]
	],
	// GFM's stop-at-`<` rule: the single left-to-right pass claims the tag first,
	// so it can never be absorbed into the url. Same for a following spec autolink.
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
	],
	[
		'autolink inside link text',
		'[see www.x.com](/u)',
		[linkNode(0, 19, [textNode(1, 5, 'see '), autolinkNode(5, 14, 'http://www.x.com')], '/u')]
	],
	[
		'autolink inside image alt structure',
		'![www.x.com](/u)',
		[imageNode(0, 16, [autolinkNode(2, 11, 'http://www.x.com')], 'www.x.com', '/u')]
	]
]);

describe('child walk under deep image nesting (DoS guard)', () => {
	it('pathological nesting parses without overflow and stays near-linear', () => {
		// 20k-deep `![…](u)` nesting — commonmark semantics build one image per
		// level. A per-level recursion in the autolink child walk overflows the
		// call stack here; the wall-clock bound is a coarse DoS backstop for
		// gross super-linear blowups (the dimension-suffix quadratic this depth
		// once exposed is pinned exactly by the bounded-suffix edge case in
		// core/inline/image-dimensions.test.ts, not by this clock).
		const depth = 20000;
		const raw = '!['.repeat(depth) + 'a' + '](u)'.repeat(depth);
		const startedAt = performance.now();
		const nodes = scanInline(raw, 0, raw.length);
		const elapsed = performance.now() - startedAt;
		expect(elapsed).toBeLessThan(2000);
		expect(nodes).toHaveLength(1);
		// Iterative descent with conditional throws: 20k expect() calls are
		// pure overhead, and a recursive assertion would itself overflow.
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
