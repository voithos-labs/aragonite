import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';
import { BOUNDED_GROWTH_CEILING, measureScanGrowth } from '../../harness/scan-growth';

/** G2.11 total coverage: every byte of the block is claimed by exactly one node. */
const tiles = (source: string) =>
	parseInline(source, 0, source.length)
		.map((n) => source.slice(n.start, n.end))
		.join('');

// Three inline scans that go super-linear when unbounded: the entity `;` search, the
// autolink paren trim, and the code-span backtick matcher. The wall-time bounds are
// generous, so they fail on a super-linear regression without flaking on slow machines.

describe('adversarial scan bounds', () => {
	it('entity-candidate flood parses in bounded time with output unchanged', () => {
		const source = '&'.repeat(800_000) + 'x;';
		const started = performance.now();
		const nodes = parseInline(source, 0, source.length);
		expect(performance.now() - started).toBeLessThan(2000);
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
		expect(nodes.map((n) => source.slice(n.start, n.end)).join('')).toBe(source);
	}, 60_000);

	it('trailing-paren flood trims in bounded time with output unchanged', () => {
		const source = 'www.x.com' + ')'.repeat(120_000);
		const started = performance.now();
		const nodes = parseInline(source, 0, source.length);
		expect(performance.now() - started).toBeLessThan(2000);
		const autolink = nodes.find((n) => n.kind === 'autolink');
		expect(autolink?.url).toBe('http://www.x.com');
		expect(nodes.map((n) => source.slice(n.start, n.end)).join('')).toBe(source);
	}, 60_000);

	it('backtick-run ladder scans in bounded time with output unchanged', () => {
		// Runs of strictly increasing length never close (no equal-length partner),
		// so a per-opener forward rescan to EOF is O(runs·n) — the O(n^1.5) ladder.
		const source = Array.from({ length: 2600 }, (_, k) => '`'.repeat(k + 1) + 'x').join('');
		const started = performance.now();
		const nodes = parseInline(source, 0, source.length);
		expect(performance.now() - started).toBeLessThan(2000);
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
		expect(nodes.map((n) => source.slice(n.start, n.end)).join('')).toBe(source);
	}, 60_000);
});

// Two failure axes in the autolink pass — the delimiter prune and the splice surgery —
// neither reachable from the round-trip generator, which caps at a few hundred bytes.
describe('GFM autolink pass bounds', () => {
	// Neither input alone is superlinear; it is the pairing. A prune that asks every
	// delimiter about every match is O(delimiters × matches).
	it('prunes delimiters against matches within a bounded growth ratio', () => {
		const source = (raw: string) => parseInline(raw, 0, raw.length);
		const { times, ratio } = measureScanGrowth(source, 'www.a.bc _x ', [48, 192]);
		expect(ratio, `48KB=${times[0].toFixed(1)}ms 192KB=${times[1].toFixed(1)}ms`).toBeLessThan(
			BOUNDED_GROWTH_CEILING
		);
	}, 300_000);

	// Spreading a match array as call arguments dies on V8's argument limit, and the
	// RangeError strands the block in the failed-block fallback, which cannot heal.
	it('splices a match count past the argument limit without throwing', () => {
		const source = 'www.a.bc '.repeat(120_000);
		expect(tiles(source)).toBe(source);
	}, 120_000);
});
