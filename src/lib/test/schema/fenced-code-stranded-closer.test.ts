import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { normalizeFencedRaw } from '$lib/schema/fenced-code-raw';
import type { CstNode } from '$lib/core/nodes';

// RESTORE's mirror at the same door: a write that took the block's OWN OPENER leaves the closer
// behind as a run no metadata claims, and that run re-opens a fence over the live siblings below
// (issue #58). Miss-analysis: the #55 pins drove writes that keep the opener and lose the closer,
// which is the only shape a START-side truncation makes; nothing drove an END-side slice, so the
// rule's decline read as correct instead of as half a rule.

const codeNode = (source: string): CstNode => parse(source).children[0];

/** What the bytes reparse to with a block below them — the sibling a stranded run swallows. */
const reloadWithSibling = (raw: string): string[] =>
	parse(`${raw}\n# Heading\n`).children.map((c) => c.kind);

describe('normalizeFencedRaw — the stranded closer', () => {
	const closed = codeNode('```js\nbody\n```\n');

	// One input shape per arm off one fixture, so a rule that stops discriminating fails here
	// rather than at whichever caller noticed first.
	it.each([
		['the closer, leaving the opener', '```js\nbo\n', '```js\nbo\n```\n'],
		['the opener, leaving the closer', 'dy\n```\n', 'dy\n'],
		['both fence lines', 'dy\nmore\n', 'dy\nmore\n']
	])('a write that took %s', (_shape, slice, expected) => {
		expect(normalizeFencedRaw(slice, closed)).toBe(expected);
	});

	it('leaves the block below a stranded closer a sibling', () => {
		expect(reloadWithSibling(normalizeFencedRaw('dy\n```\n', closed))).toEqual([
			'paragraph',
			'heading'
		]);
	});

	it('drops a stranded closer longer than the block’s own run', () => {
		const tilde = codeNode('~~~js\nbody\n~~~~~\n');
		expect(normalizeFencedRaw('~~~~~\n', tilde)).toBe('\n');
	});

	// Reads as this fence's closer AND as a bare opener; the block it would open is one no
	// metadata claims, so the closer reading wins and the run goes.
	it('drops a lone closer line', () => {
		const bare = codeNode('```\nbody\n```\n');
		expect(normalizeFencedRaw('```\n', bare)).toBe('\n');
	});

	// Only an opener that could CLOSE on the run (same marker, no longer) is a live terminator;
	// a foreign-marker open line is body text the run never terminated.
	it('drops it past a foreign-marker open line above', () => {
		expect(normalizeFencedRaw('~~~\nbody\n```\n', closed)).toBe('~~~\nbody\n');
	});

	it('rejoins the surviving lines on the block’s own ending (G4.20)', () => {
		const crlf = codeNode('```js\r\nbody\r\n```\r\n');
		expect(normalizeFencedRaw('dy\r\n```\r\n', crlf)).toBe('dy\r\n');
	});

	// The run is a live block's terminator, not residue, so dropping it would unclose that block
	// instead of the deleted one.
	it('declines when a fence opener above the run claims it', () => {
		expect(normalizeFencedRaw('x\n```js\nbody\n```\n', closed)).toBe('x\n```js\nbody\n```\n');
		expect(reloadWithSibling('x\n```js\nbody\n```\n')).toEqual([
			'paragraph',
			'fencedCode',
			'heading'
		]);
	});

	it('is idempotent — a second pass finds no closer to drop', () => {
		const once = normalizeFencedRaw('dy\n```\n', closed);
		expect(normalizeFencedRaw(once, closed)).toBe(once);
	});

	// An open fence's metadata claims no closer, so no write can strand one.
	it('declines for a fence the metadata never closed', () => {
		const open = codeNode('```js\nbody\n');
		expect(normalizeFencedRaw('dy\n```\n', open)).toBe('dy\n```\n');
	});
});
