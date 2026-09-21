import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { normalizeFencedRaw } from '$lib/schema/fenced-code-raw';
import type { CstNode } from '$lib/core/nodes';

// The mirror image at the same entry point: a write that took the block's own opener leaves the
// closer behind as a run nothing claims, and that run opens a fence over the real blocks below
// (issue #58). Miss-analysis: the #55 tests drove writes that keep the opener and lose the closer,
// the only shape a truncation from the start makes; nothing drove a cut at the end, so the rule's
// decline looked correct instead of like half a rule.

const codeNode = (source: string): CstNode => parse(source).children[0];

/** What the bytes reparse to with a block below them: the sibling a left-over run swallows. */
const reloadWithSibling = (raw: string): string[] =>
	parse(`${raw}\n# Heading\n`).children.map((c) => c.kind);

describe('normalizeFencedRaw: the stranded closer', () => {
	const closed = codeNode('```js\nbody\n```\n');

	// One input shape per branch from one fixture, so a rule that stops telling them apart fails
	// here rather than at whichever caller noticed first.
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

	// Reads both as this fence's closer and as a bare opener; the block it would open is one
	// nothing claims, so the closer reading wins and the run goes.
	it('drops a lone closer line', () => {
		const bare = codeNode('```\nbody\n```\n');
		expect(normalizeFencedRaw('```\n', bare)).toBe('\n');
	});

	// Only an open line that could close on the run (same marker, no longer) really closes it; an
	// open line with a different marker is body text the run never closed.
	it('drops it past a foreign-marker open line above', () => {
		expect(normalizeFencedRaw('~~~\nbody\n```\n', closed)).toBe('~~~\nbody\n');
	});

	it('rejoins the surviving lines on the block’s own ending (G4.20)', () => {
		const crlf = codeNode('```js\r\nbody\r\n```\r\n');
		expect(normalizeFencedRaw('dy\r\n```\r\n', crlf)).toBe('dy\r\n');
	});

	// The run closes a real block rather than being left over, so dropping it would leave that
	// block open instead of the deleted one.
	it('declines when a fence opener above the run claims it', () => {
		expect(normalizeFencedRaw('x\n```js\nbody\n```\n', closed)).toBe('x\n```js\nbody\n```\n');
		expect(reloadWithSibling('x\n```js\nbody\n```\n')).toEqual([
			'paragraph',
			'fencedCode',
			'heading'
		]);
	});

	it('is idempotent: a second pass finds no closer to drop', () => {
		const once = normalizeFencedRaw('dy\n```\n', closed);
		expect(normalizeFencedRaw(once, closed)).toBe(once);
	});

	// An open fence's metadata says it has no closer, so no write can leave one behind.
	it('declines for a fence the metadata never closed', () => {
		const open = codeNode('```js\nbody\n');
		expect(normalizeFencedRaw('dy\n```\n', open)).toBe('dy\n```\n');
	});
});
