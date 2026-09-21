import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerTocBlock, tocPlugin, TOC_BLOCK } from '$lib/plugins/toc/toc-plugin';
import { roundTripCases } from '$lib/test/support/round-trip';

// A leaked registration would let the dormant-until-registered gate below pass for
// the wrong reason, so every case starts from a cleared platform.
beforeEach(resetPluginPlatformForTests);
afterEach(resetPluginPlatformForTests);

// Recognition starts only once the opener registers: with no plugin loaded `[[toc]]` is an
// ordinary paragraph, byte-identical to plain GFM.
describe('toc is dormant until registered', () => {
	it('leaves a [[toc]] line as a paragraph with nothing registered', () => {
		const src = '# H\n\n[[toc]]\n';
		expect(parse(src).children[1].kind).toBe('paragraph');
		expect(serialize(parse(src))).toBe(src);
	});
});

// Grammar: the opener takes only the exact line `[[toc]]`. Indentation or trailing content
// falls through to a paragraph, and that strictness is what keeps this opener out of the way
// in every other plugin's documents.
describe('toc recognition', () => {
	beforeEach(registerTocBlock);

	const recognition: Array<[string, string, boolean]> = [
		['exact line', '[[toc]]\n', true],
		['exact line, no trailing newline', '[[toc]]', true],
		['indented one space', ' [[toc]]\n', false],
		['trailing content', '[[toc]] contents\n', false],
		['leading content', 'see [[toc]]\n', false],
		['uppercase', '[[TOC]]\n', false],
		['single bracket', '[toc]\n', false]
	];
	for (const [name, src, recognized] of recognition) {
		it(`${name} → ${recognized ? 'toc' : 'paragraph'}`, () => {
			expect(parse(src).children[0].kind).toBe(recognized ? TOC_BLOCK : 'paragraph');
		});
	}

	it('parses the line to a single source-holding leaf (no children)', () => {
		const node = parse('[[toc]]\n').children[0];
		expect(node.kind).toBe(TOC_BLOCK);
		expect(node.children).toBeUndefined();
		expect(node.raw).toBe('[[toc]]\n');
	});

	it('interrupts an open paragraph, splitting the toc onto its own block', () => {
		const doc = parse('intro\n[[toc]]\n');
		expect(doc.children.map((c) => c.kind)).toEqual(['paragraph', TOC_BLOCK]);
	});

	it('recognizes a [[toc]] nested inside a blockquote', () => {
		const quote = parse('> [[toc]]\n').children[0];
		expect(quote.kind).toBe('blockquote');
		expect(quote.children?.[0].kind).toBe(TOC_BLOCK);
	});
});

// The round trip is the guarantee that matters: serialize re-emits `leadingTrivia + raw`, so
// a `raw` taken verbatim from the consumed line round-trips byte for byte. The declined rows
// prove the shapes it does not take keep their bytes too.
describe('toc round-trip', () => {
	beforeEach(registerTocBlock);

	roundTripCases([
		'[[toc]]\n',
		'# Overview\n\n## Details\n\n[[toc]]\n\nFooter\n',
		'Appendix\n========\n\n[[toc]]\n',
		'> [[toc]]\n',
		'# H\n\n> [[toc]]\n\nAfter\n',
		'intro\n[[toc]]\n',
		' [[toc]]\n',
		'[[toc]] contents\n',
		'[[toc]]'
	]);
});

describe('tocPlugin wires the opener', () => {
	it('makes a [[toc]] line parse as a toc block through the installed plugin', () => {
		installPlugins([tocPlugin()]);
		expect(parse('[[toc]]\n').children[0].kind).toBe(TOC_BLOCK);
	});
});
