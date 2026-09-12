import { describe, it, expect } from 'vitest';
import { diffInput, type Divergence } from './differ';
import {
	explainDivergence,
	foldBareAutolinks,
	eraseImageAlt,
	hasAstralBesideDelimiter
} from './excuses';
import type { NormalNode } from './normalize';

// Miss-analysis: the excuse rule's only test was the property's own self-test, which bucketed
// inputs by the same input predicate it was auditing, so the rule agreed with itself; nothing
// ever fed it a divergence whose input matched a class its diverging kinds did not.

function text(value: string): NormalNode {
	return { kind: 'text', text: value };
}

function emphasis(value: string): NormalNode {
	return { kind: 'emphasis', children: [text(value)] };
}

function bareAutolink(bytes: string, url: string, start: number): NormalNode {
	return {
		kind: 'link',
		url,
		autolinkSpan: { start, end: start + bytes.length },
		children: [text(bytes)]
	};
}

const httpsLink = bareAutolink('https://example.com', 'https://example.com', 0);

describe('explainDivergence', () => {
	it('refuses an emphasis divergence that merely sits beside a bare autolink', () => {
		const divergence: Divergence = {
			input: 'https://example.com *foo*',
			ours: [httpsLink, text(' '), emphasis('foo')],
			theirs: [text('https://example.com *foo*')]
		};
		expect(explainDivergence(divergence)).toBeNull();
	});

	it('explains a bare autolink the reference read as plain text', () => {
		const divergence = diffInput('https://example.com');
		expect(divergence).not.toBeNull();
		expect(explainDivergence(divergence!)).toBe('gfm-bare-autolink');
	});

	it('explains a bare autolink nested inside emphasis', () => {
		const divergence: Divergence = {
			input: '*https://example.com*',
			ours: [{ kind: 'emphasis', children: [bareAutolink('https://example.com', 'u', 1)] }],
			theirs: [{ kind: 'emphasis', children: [text('https://example.com')] }]
		};
		expect(explainDivergence(divergence)).toBe('gfm-bare-autolink');
	});

	it('explains the delimiters a bare autolink kept out of the reference pairing', () => {
		const divergence = diffInput('*www.example.com*');
		expect(divergence).not.toBeNull();
		expect(explainDivergence(divergence!)).toBe('gfm-bare-autolink');
	});

	it('refuses a divergence whose bytes differ outside a reaching autolink', () => {
		const divergence: Divergence = {
			input: '*www.example.com* `a`',
			ours: [
				text('*'),
				bareAutolink('www.example.com', 'http://www.example.com', 1),
				text('* '),
				{ kind: 'code', text: 'a' }
			],
			theirs: [emphasis('www.example.com'), text(' `a`')]
		};
		expect(explainDivergence(divergence)).toBeNull();
	});

	it('explains an image alt read as raw label bytes on our side only', () => {
		const divergence = diffInput('![foo [bar](/url)](/url2)');
		expect(divergence).not.toBeNull();
		expect(explainDivergence(divergence!)).toBe('image-alt-structure');
	});

	it('refuses an image divergence outside the alt subtree', () => {
		const divergence: Divergence = {
			input: '![foo [bar](/u)](/url2)',
			ours: [{ kind: 'image', url: '/wrong', children: [text('foo [bar](/u)')] }],
			theirs: [
				{
					kind: 'image',
					url: '/url2',
					children: [text('foo '), { kind: 'link', url: '/u', children: [text('bar')] }]
				}
			]
		};
		expect(explainDivergence(divergence)).toBeNull();
	});

	it('explains an input carrying both an autolink and an image alt', () => {
		const divergence: Divergence = {
			input: 'www.example.com ![a *b*](/u)',
			ours: [
				bareAutolink('www.example.com', 'http://www.example.com', 0),
				text(' '),
				{ kind: 'image', url: '/u', children: [text('a *b*')] }
			],
			theirs: [
				text('www.example.com '),
				{ kind: 'image', url: '/u', children: [text('a '), emphasis('b')] }
			]
		};
		expect(explainDivergence(divergence)).toBe('image-alt-structure');
	});

	it('refuses an astral divergence with no delimiter neighbour', () => {
		const divergence: Divergence = {
			input: '😀 foo `bar`',
			ours: [text('😀 foo '), { kind: 'code', text: 'bar' }],
			theirs: [text('😀 foo `bar`')]
		};
		expect(explainDivergence(divergence)).toBeNull();
	});

	it('explains an astral code point touching a delimiter run', () => {
		const divergence = diffInput("𐄀*)*\"(''aé");
		expect(divergence).not.toBeNull();
		expect(explainDivergence(divergence!)).toBe('emphasis-flanking-astral');
	});
});

describe('neutralizers', () => {
	it('folds a bare autolink to its bytes and merges the neighbouring text', () => {
		expect(foldBareAutolinks([text('< '), httpsLink, text(' >')])).toEqual([
			text('< https://example.com >')
		]);
	});

	it('leaves a bracketed link alone', () => {
		const link: NormalNode = { kind: 'link', url: '/u', children: [text('a')] };
		expect(foldBareAutolinks([link])).toEqual([link]);
	});

	it('erases an image alt at any depth without touching its url or siblings', () => {
		const nested: NormalNode[] = [
			emphasis('keep'),
			{
				kind: 'link',
				url: '/u',
				children: [{ kind: 'image', url: '/i', title: 't', children: [text('alt *x*')] }]
			}
		];
		expect(eraseImageAlt(nested)).toEqual([
			emphasis('keep'),
			{
				kind: 'link',
				url: '/u',
				children: [{ kind: 'image', url: '/i', title: 't', children: [] }]
			}
		]);
	});

	it('reads astral adjacency on either side of the delimiter run', () => {
		expect(hasAstralBesideDelimiter('a𐄀_b')).toBe(true);
		expect(hasAstralBesideDelimiter('a**𐄀b')).toBe(true);
		expect(hasAstralBesideDelimiter('a𐄀 _b_')).toBe(false);
		expect(hasAstralBesideDelimiter('*é*')).toBe(false);
	});
});
