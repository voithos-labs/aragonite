import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';
import { BOUNDED_GROWTH_CEILING, measureScanGrowth } from '../../harness/scan-growth';

/** G2.11 total coverage: every byte of the block is claimed by exactly one node. */
const tiles = (source: string) =>
	parseInline(source, 0, source.length)
		.map((n) => source.slice(n.start, n.end))
		.join('');

const scan = (source: string) => void parseInline(source, 0, source.length);

const growthDetail = (times: [number, number]) =>
	`small=${times[0].toFixed(1)}ms large=${times[1].toFixed(1)}ms`;

// Three inline scans that go super-linear when unbounded: the entity `;` search, the autolink
// paren trim, and the code-span backtick matcher. Each is priced as the N-vs-4N ratio rather than
// a wall-clock budget, so the bound is the machine-independent one, and the output claim rides
// beside it at a single size.

describe('adversarial scan bounds', () => {
	it('entity-candidate flood scans within a bounded growth ratio, output unchanged', () => {
		const { times, ratio } = measureScanGrowth(scan, '&', [64, 256]);
		expect(ratio, growthDetail(times)).toBeLessThan(BOUNDED_GROWTH_CEILING);

		const source = '&'.repeat(200_000) + 'x;';
		const nodes = parseInline(source, 0, source.length);
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
		expect(tiles(source)).toBe(source);
	}, 300_000);

	it('trailing-paren flood trims within a bounded growth ratio, output unchanged', () => {
		// The tail is the shape, so the per-sample distinctness goes in the domain: a `z` run
		// AFTER the parens would end the match on a non-punctuation byte and trim nothing.
		const parenTail = (bytes: number, salt: string) =>
			'www.x.com' + salt + ')'.repeat(Math.max(1, bytes - 9 - salt.length));
		const { times, ratio } = measureScanGrowth(scan, parenTail, [32, 128]);
		expect(ratio, growthDetail(times)).toBeLessThan(BOUNDED_GROWTH_CEILING);

		const source = 'www.x.com' + ')'.repeat(120_000);
		const autolink = parseInline(source, 0, source.length).find((n) => n.kind === 'autolink');
		expect(autolink?.url).toBe('http://www.x.com');
		expect(tiles(source)).toBe(source);
	}, 300_000);

	// Totality is the pin (the DoS guard), not tree shape: the §6.3 links-in-links
	// deactivation shape is pinned in the scan suite.
	it('parses 2000-deep bracket nesting without throwing and covers all bytes', () => {
		const source = '['.repeat(2000) + 'a' + '](u)'.repeat(2000);
		expect(tiles(source)).toBe(source);
	});

	it('backtick-run ladder scans within a bounded growth ratio, output unchanged', () => {
		// Runs of strictly increasing length never close (no equal-length partner), so a
		// per-opener forward rescan to EOF is O(runs·n) — the O(n^1.5) ladder.
		const ladder = (bytes: number, salt: string) => {
			let out = salt;
			for (let k = 1; out.length < bytes; k++) out += '`'.repeat(k) + 'x';
			return out;
		};
		const { times, ratio } = measureScanGrowth(scan, ladder, [16, 64]);
		expect(ratio, growthDetail(times)).toBeLessThan(BOUNDED_GROWTH_CEILING);

		const source = Array.from({ length: 2600 }, (_, k) => '`'.repeat(k + 1) + 'x').join('');
		expect(parseInline(source, 0, source.length).every((n) => n.kind === 'text')).toBe(true);
		expect(tiles(source)).toBe(source);
	}, 300_000);
});

// Two failure axes in the autolink pass — the delimiter prune and the splice surgery —
// neither reachable from the round-trip generator, which caps at a few hundred bytes.
describe('GFM autolink pass bounds', () => {
	// Neither input alone is superlinear; it is the pairing. A prune that asks every
	// delimiter about every match is O(delimiters × matches).
	it('prunes delimiters against matches within a bounded growth ratio', () => {
		const { times, ratio } = measureScanGrowth(scan, 'www.a.bc _x ', [48, 192]);
		expect(ratio, growthDetail(times)).toBeLessThan(BOUNDED_GROWTH_CEILING);
	}, 300_000);

	// Spreading a match array as call arguments dies on V8's argument limit, and the
	// RangeError strands the block in the failed-block fallback, which cannot heal.
	it('splices a match count past the argument limit without throwing', () => {
		const source = 'www.a.bc '.repeat(120_000);
		expect(tiles(source)).toBe(source);
	}, 120_000);
});
