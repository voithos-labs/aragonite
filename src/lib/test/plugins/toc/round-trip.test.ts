import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { installPlugins } from '$lib';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerTocBlock, tocPlugin, TOC_BLOCK } from '$lib/plugins/toc/toc-plugin';
import { roundTripCases } from '$lib/test/support/round-trip';

// The opener registers through the schema registry alone (no inline path), so the
// schema reset is the whole teardown — a leaked registration would let the
// dormant-until-registered gate pass for the wrong reason.
beforeEach(__resetSchemaRegistriesForTests);
afterEach(__resetSchemaRegistriesForTests);

// Recognition is gated on the opener registering — with no plugin loaded `[[toc]]`
// is an ordinary paragraph, byte-identical to bare GFM.
describe('toc is dormant until registered', () => {
	it('leaves a [[toc]] line as a paragraph with nothing registered', () => {
		const src = '# H\n\n[[toc]]\n';
		expect(parse(src).children[1].kind).toBe('paragraph');
		expect(serialize(parse(src))).toBe(src);
	});
});

// Grammar: the opener claims ONLY the exact line `[[toc]]`. Indentation or trailing
// content declines to a paragraph — the exact-match strictness that keeps the
// process-wide opener inert for every sibling plugin document.
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

// Round-trip is the load-bearing guarantee: serialize re-emits `leadingTrivia + raw`,
// so a `raw` taken verbatim from the consumed line round-trips byte-for-byte. The
// decline rows prove the non-claimed shapes preserve their bytes too.
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
