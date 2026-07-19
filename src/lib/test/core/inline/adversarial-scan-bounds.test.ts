import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';

// Stopgap bounds for three super-linear inline scans: the entity `;` search is
// capped at the longest possible reference body, the autolink paren trim keeps a
// running balance instead of recounting per `)`, and the code-span matcher
// indexes backtick runs once instead of rescanning to EOF per opener. Wall-time
// bounds are generous (~20x post-fix headroom at these sizes) so they fail on a
// super-linear regression (>10s) without flaking on slow machines.

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
