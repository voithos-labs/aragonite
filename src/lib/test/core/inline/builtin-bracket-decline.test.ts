// The editor declines a plugin's claim at `[` or `![` wherever the built-in reading of that
// bracket closes it as a link or image inside the claim, so no plugin decides the overlap itself.
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { InlineNode } from '#lib';
import { parseInline } from '#lib';
import { INLINE_PRIORITIES, registerInlineSyntax } from '#lib/plugin.js';
import { resetPluginPlatformForTests } from '#lib/testing.js';
import { Scan } from '#lib/core/inline/scan/scan.js';
import { arbInlineSource } from '../../invariants/arbitraries/inline';
import { freshOrFixedSeed } from '../../invariants/arbitraries/property-seed';
import { expectBoundedGrowth, measureScanGrowth } from '../../harness/scan-growth';

/** Claims every `open … close` with no line break inside, as limestone's `[[` and `![[` do minus
 *  their own overlap checks. */
function swallow(kind: string, trigger: string, open: string, close: string): void {
	registerInlineSyntax(
		trigger,
		(raw, pos, end) => {
			if (!raw.startsWith(open, pos)) return null;
			const at = raw.indexOf(close, pos + open.length);
			if (at < 0 || at + close.length > end || raw.slice(pos, at).includes('\n')) return null;
			return { kind: kind as InlineNode['kind'], start: pos, end: at + close.length };
		},
		{ prefix: open, priority: INLINE_PRIORITIES.prefixOverride }
	);
}

const wiki = () => swallow('wiki', '[', '[[', ']]');
const embed = () => swallow('embed', '!', '![[', ']]');
const footnote = () => swallow('note', '[', '[^', ']');
const caret = () => swallow('caret', '[', '[^', '');

const kinds = (raw: string, resolver?: (label: string) => { url: string } | undefined) =>
	parseInline(raw, 0, raw.length, resolver).map((n) => n.kind);

describe('a plugin claim at a bracket a built-in link or image completes from', () => {
	it.each([
		['an inline image', embed, '![[a]](https://x.dev)', ['image']],
		['an inline link', wiki, '[[note]](https://x.dev)', ['link']],
		['a link to a defined reference', wiki, '[[note]][r]', ['link']],
		['a footnote-shaped link, as GitHub reads it', footnote, '[^1](https://x.dev)', ['link']],
		['a footnote-shaped reference link', footnote, '[^1][r]', ['link']]
	])('goes to the built-in: %s', (_name, register, raw, expected) => {
		register();
		expect(kinds(raw, (label) => (label === 'r' ? { url: '/r' } : undefined))).toEqual(expected);
	});

	it.each([
		['a wiki link', wiki, '[[note]]', ['wiki']],
		['an embed', embed, '![[a.png]]', ['embed']],
		['a wiki link before an undefined reference', wiki, '[[note]][r]', ['wiki', 'text']],
		['a wiki link inside a link', wiki, '[see [[note]]](u)', ['link']],
		['a footnote reference', footnote, 'a[^1] b', ['text', 'note', 'text']],
		['a claim that ends before its bracket closes', caret, '[^x](u)', ['caret', 'text']]
	])('stays the plugin’s: %s', (_name, register, raw, expected) => {
		register();
		expect(kinds(raw)).toEqual(expected);
	});

	// The guide's two examples: a claim that ends before the bracket around it closes, and a
	// defined label inside a claim, whose bracket isn't the one the claim starts on.
	it('keeps a claim that ends before its link closes, and one around a defined label', () => {
		wiki();
		expect(kinds('[[[[deep]]]](https://x.dev)')[0]).toBe('wiki');
		expect(kinds('[[ref]]', (label) => (label === 'ref' ? { url: '/r' } : undefined))).toEqual([
			'wiki'
		]);
	});

	it('keeps the plugin’s node inside the link its bracket sits in', () => {
		wiki();
		const [link] = parseInline('[see [[note]]](u)', 0, 17);
		expect(link.children?.map((n) => n.kind)).toEqual(['text', 'wiki']);
	});
});

// Miss-analysis: the decline's rows checked what a claim reads as, never what it cost, so a
// footnote reference probed its bracket with no definition that could make it a link.
describe('the probe behind the decline', () => {
	const probes = () => vi.spyOn(Scan.prototype as unknown as { completes(): boolean }, 'completes');
	const noteDefined = (label: string) => (label === '^1' ? { url: '/n' } : undefined);

	it.each([
		['no `[^`', 'plain words, a [link](u) and [x]'],
		['four `[^` claims', 'a [^1] b [^2] c [^3] d [^4]']
	])('runs for none of %s, as no probe did before the decline', (_name, raw) => {
		footnote();
		const counted = probes();
		kinds(raw, () => undefined);
		expect(counted).not.toHaveBeenCalled();
	});

	it('runs for a claim whose label a definition names, which reads as the link', () => {
		footnote();
		const counted = probes();
		expect(kinds('[^1] and [^2]', noteDefined)).toEqual(['link', 'text', 'note']);
		expect(counted).toHaveBeenCalledTimes(1);
	});
});

// Every built-in link or image a clean parse finds survives a plugin that claims every bracket.
describe('a swallowing plugin never takes a built-in link or image', () => {
	const tokens = fc.constantFrom('[[a]]', '![[a]]', '[[a]](u)', '![[a]](u)', '[^1]', '(u)', ']]');
	const source = fc
		.array(fc.oneof(arbInlineSource, tokens), { maxLength: 6 })
		.map((parts) => parts.join(''));
	const walk = (nodes: InlineNode[], out: InlineNode[] = []): InlineNode[] => {
		for (const n of nodes) {
			out.push(n);
			if (n.children) walk(n.children, out);
		}
		return out;
	};
	/** Where a link's or image's text ends: its closing bracket. */
	const closingBracket = (n: InlineNode) =>
		n.children?.length ? n.children.at(-1)!.end : n.start + (n.kind === 'image' ? 2 : 1);

	it('never claims a bracket that closes as a link or image inside the claim', () => {
		fc.assert(
			fc.property(source, (raw) => {
				resetPluginPlatformForTests();
				const clean = walk(parseInline(raw, 0, raw.length)).filter(
					(n) => n.kind === 'link' || n.kind === 'image'
				);
				wiki();
				embed();
				footnote();
				const claims = walk(parseInline(raw, 0, raw.length)).filter((n) =>
					['wiki', 'embed', 'note'].includes(n.kind)
				);
				for (const claim of claims) {
					const lost = clean.find((n) => n.start === claim.start && closingBracket(n) < claim.end);
					expect(lost, `${claim.kind} took ${JSON.stringify(raw)} at ${claim.start}`).toBe(
						undefined
					);
				}
			}),
			{ numRuns: 1000, seed: freshOrFixedSeed(424242) }
		);
	});
});

it('reads 4000-deep wiki brackets without throwing', () => {
	wiki();
	const raw = '['.repeat(4000) + 'a' + ']'.repeat(4000);
	expect(
		parseInline(raw, 0, raw.length)
			.map((n) => raw.slice(n.start, n.end))
			.join('')
	).toBe(raw);
});

describe('the decline’s cost grows with the text', () => {
	const scan = (raw: string) => void parseInline(raw, 0, raw.length);
	it.each([
		['wiki links', wiki, '[[note]] word '],
		['embeds', embed, '![[a.png]] word '],
		['links built from wiki brackets', wiki, '[[note]](u) word '],
		['nested wiki brackets', wiki, '[[[[a]]]] '],
		[
			'code spans across wiki brackets',
			wiki,
			(bytes: number, salt: string) => {
				let out = salt;
				for (let k = 1; out.length < bytes; k++) out += '[[a' + '`'.repeat(k) + ']] ';
				return out;
			}
		],
		// The tag hides the claim's `]]`, so neither bracket ever closes.
		['tags across wiki brackets', wiki, '[[a<b title="]]"> '],
		// A `[^` claim always probes, so only the stop at the claim's end bounds this one.
		['tags across footnote-shaped claims', footnote, '[^a<b title="]"> ']
	])(
		'%s scan within a bounded growth ratio',
		(_name, register, shape) => {
			register();
			expectBoundedGrowth(measureScanGrowth(scan, shape, [16, 64]));
		},
		300_000
	);
});
