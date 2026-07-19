import { describe, it, expect } from 'vitest';
import { scanInline } from '../../../../core/inline/scan';
import {
	assertConstructCoverage,
	assertTotalCoverage,
	collectKind,
	describeScanCases,
	emphasisNode,
	imageNode,
	linkNode,
	textNode
} from './scan-test-helpers';

// Bracket-stack semantics: pairing, nesting, links-in-links deactivation,
// and failure-as-literal. Every expectation verified against commonmark.js
// 0.31.2 (the conformance differ's target).

describeScanCases('inline link and image node shape', [
	['simple link', '[a](b)', [linkNode(0, 6, [textNode(1, 2, 'a')], 'b')]],
	[
		'image with title',
		'![a](b "t")',
		[imageNode(0, 11, [textNode(2, 3, 'a')], 'a', 'b', { title: 't' })]
	],
	[
		'image dimensions parse from the label',
		'![a|100x200](b)',
		[imageNode(0, 15, [textNode(2, 11, 'a|100x200')], 'a', 'b', { width: 100, height: 200 })]
	],
	['empty label', '[](b)', [linkNode(0, 5, [], 'b')]],
	[
		'empty title stays distinct from absent',
		'[a](b "")',
		[linkNode(0, 9, [textNode(1, 2, 'a')], 'b', { title: '' })]
	],
	[
		'emphasis in the label wraps at match time',
		'[*a* b](c)',
		[linkNode(0, 10, [emphasisNode(1, 4, [textNode(2, 3, 'a')]), textNode(4, 6, ' b')], 'c')]
	],
	[
		'unmatched bracket pair inside the label stays literal',
		'[a [b]](c)',
		[linkNode(0, 10, [textNode(1, 6, 'a [b]')], 'c')]
	]
]);

describeScanCases('links-in-links: a matched link deactivates enclosing link openers', [
	[
		'link inside link: inner wins, outer literal',
		'[a [b](c)](d)',
		[textNode(0, 3, '[a '), linkNode(3, 9, [textNode(4, 5, 'b')], 'c'), textNode(9, 13, '](d)')]
	],
	[
		'image inside image: both match',
		'![a ![b](c)](d)',
		[
			imageNode(
				0,
				15,
				[textNode(2, 4, 'a '), imageNode(4, 11, [textNode(6, 7, 'b')], 'b', 'c')],
				'a ![b](c)',
				'd'
			)
		]
	],
	[
		'image inside link: both match',
		'[a ![b](c)](d)',
		[
			linkNode(
				0,
				14,
				[textNode(1, 3, 'a '), imageNode(3, 10, [textNode(5, 6, 'b')], 'b', 'c')],
				'd'
			)
		]
	],
	[
		'baseline links-in-links exemplar',
		'[foo [bar](/uri)](/uri)',
		[
			textNode(0, 5, '[foo '),
			linkNode(5, 16, [textNode(6, 9, 'bar')], '/uri'),
			textNode(16, 23, '](/uri)')
		]
	]
]);

describe('bracket and emphasis interaction', () => {
	it('delimiters below the bracket floor stay untouched by the match', () => {
		const raw = '*a [b*](c)';
		const nodes = scanInline(raw, 0, raw.length);
		assertTotalCoverage(nodes, 0, raw.length);
		assertConstructCoverage(nodes);
		expect(nodes).toEqual([textNode(0, 3, '*a '), linkNode(3, 10, [textNode(4, 6, 'b*')], 'c')]);
	});

	it('emphasis around a deactivated pair keeps only the innermost link', () => {
		const raw = '[foo *[bar [baz](/uri)](/uri)*](/uri)';
		const nodes = scanInline(raw, 0, raw.length);
		assertTotalCoverage(nodes, 0, raw.length);
		assertConstructCoverage(nodes);
		expect(collectKind(nodes, 'link')).toEqual([
			linkNode(11, 22, [textNode(12, 15, 'baz')], '/uri')
		]);
		const emphasis = collectKind(nodes, 'emphasis');
		expect(emphasis).toHaveLength(1);
		expect([emphasis[0].start, emphasis[0].end]).toEqual([5, 30]);
	});
});

describe('image label structure (baseline image-alt-structure)', () => {
	it('nested image label keeps structured children and a flattened alt', () => {
		const raw = '![[[foo](uri1)](uri2)](uri3)';
		const nodes = scanInline(raw, 0, raw.length);
		assertTotalCoverage(nodes, 0, raw.length);
		assertConstructCoverage(nodes);
		expect(nodes).toEqual([
			imageNode(
				0,
				28,
				[
					textNode(2, 3, '['),
					linkNode(3, 14, [textNode(4, 7, 'foo')], 'uri1'),
					textNode(14, 21, '](uri2)')
				],
				'[[foo](uri1)](uri2)',
				'uri3'
			)
		]);
	});
});

describeScanCases('close bracket with no opener on the stack stays literal', [
	[
		'stray ] after a matched link',
		'[a](b)]x',
		[linkNode(0, 6, [textNode(1, 2, 'a')], 'b'), textNode(6, 8, ']x')]
	],
	[
		'stray ] before an opener',
		'a][b](c)',
		[textNode(0, 2, 'a]'), linkNode(2, 8, [textNode(3, 4, 'b')], 'c')]
	]
]);

describe('unmatched brackets stay literal', () => {
	const literalInputs: Array<[name: string, input: string]> = [
		['close bracket without opener', 'a]b'],
		['opener without closer', '[a'],
		['unterminated tail', '[a](x'],
		['label and tail split by a newline', '[a]\n(b)']
	];
	for (const [name, input] of literalInputs) {
		it(name, () => {
			const nodes = scanInline(input, 0, input.length);
			assertTotalCoverage(nodes, 0, input.length);
			expect(collectKind(nodes, 'link')).toEqual([]);
			expect(collectKind(nodes, 'image')).toEqual([]);
		});
	}
});
