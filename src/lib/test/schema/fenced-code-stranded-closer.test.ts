import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { fencedCodeWrite } from '$lib/schema/fenced-code-raw';
import type { CstNode } from '$lib/core/nodes';

/** The document line ending a write runs under, LF or CRLF. */
const LF_WRITE = { lineEnding: '\n' } as const;
const CRLF_WRITE = { lineEnding: '\r\n' } as const;

/** The fence rule as a byte write from outside the block's own editing applies it. */
const literalWrite = (raw: string, node: CstNode, write: typeof LF_WRITE | typeof CRLF_WRITE) =>
	fencedCodeWrite.normalize(raw, { node, mode: 'literal', lineEnding: write.lineEnding });

// A write that took the opener leaves the closer as an unowned run that fences the blocks below.
// Miss-analysis: GH #58; every truncation test kept the opener, so none left a closer behind.

const codeNode = (source: string): CstNode => parse(source).children[0];

/** What the bytes reparse to with a block below them: the sibling a left-over run swallows. */
const reloadWithSibling = (raw: string): string[] =>
	parse(`${raw}\n# Heading\n`).children.map((c) => c.kind);

describe('the fence rule as a literal write: the stranded closer', () => {
	const closed = codeNode('```js\nbody\n```\n');

	// One input shape per branch from one fixture, so a rule that stops telling them apart fails
	// here rather than at whichever caller noticed first.
	it.each([
		['the closer, leaving the opener', '```js\nbo\n', '```js\nbo\n```\n'],
		['the opener, leaving the closer', 'dy\n```\n', 'dy\n'],
		['both fence lines', 'dy\nmore\n', 'dy\nmore\n']
	])('a write that took %s', (_shape, slice, expected) => {
		expect(literalWrite(slice, closed, LF_WRITE)).toBe(expected);
	});

	it('leaves the block below a stranded closer a sibling', () => {
		expect(reloadWithSibling(literalWrite('dy\n```\n', closed, LF_WRITE))).toEqual([
			'paragraph',
			'heading'
		]);
	});

	it('drops a stranded closer longer than the block’s own run', () => {
		const tilde = codeNode('~~~js\nbody\n~~~~~\n');
		expect(literalWrite('~~~~~\n', tilde, LF_WRITE)).toBe('\n');
	});

	// The line reads both as this fence's closer and as a bare opener; no block owns what it would
	// open, so the closer reading wins and the run goes.
	it('drops a lone closer line', () => {
		const bare = codeNode('```\nbody\n```\n');
		expect(literalWrite('```\n', bare, LF_WRITE)).toBe('\n');
	});

	// Only an open line that could close on the run (same marker, not longer) really closes it; an
	// open line with a different marker is body text the run never closed.
	it('drops it past a foreign-marker open line above', () => {
		expect(literalWrite('~~~\nbody\n```\n', closed, LF_WRITE)).toBe('~~~\nbody\n');
	});

	it('rejoins the surviving lines on the block’s own ending (G4.20)', () => {
		const crlf = codeNode('```js\r\nbody\r\n```\r\n');
		expect(literalWrite('dy\r\n```\r\n', crlf, CRLF_WRITE)).toBe('dy\r\n');
	});

	// The run closes a real block rather than being left over, so dropping it would leave that
	// block open instead of the deleted one.
	it('declines when a fence opener above the run claims it', () => {
		expect(literalWrite('x\n```js\nbody\n```\n', closed, LF_WRITE)).toBe('x\n```js\nbody\n```\n');
		expect(reloadWithSibling('x\n```js\nbody\n```\n')).toEqual([
			'paragraph',
			'fencedCode',
			'heading'
		]);
	});

	it('is idempotent: a second pass finds no closer to drop', () => {
		const once = literalWrite('dy\n```\n', closed, LF_WRITE);
		expect(literalWrite(once, closed, LF_WRITE)).toBe(once);
	});

	// An open fence's metadata says it has no closer, so no write can leave one behind.
	it('declines for a fence the metadata never closed', () => {
		const open = codeNode('```js\nbody\n');
		expect(literalWrite('dy\n```\n', open, LF_WRITE)).toBe('dy\n```\n');
	});
});
