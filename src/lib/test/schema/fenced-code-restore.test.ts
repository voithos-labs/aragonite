import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { fencedCodeWrite } from '$lib/schema/fenced-code-raw';
import { metadataOf, type CstNode } from '$lib/core/nodes';

/** The document line ending a write runs under, LF or CRLF. */
const LF_WRITE = { lineEnding: '\n' } as const;
const CRLF_WRITE = { lineEnding: '\r\n' } as const;

/** The fence rule as a byte write from outside the block's own editing applies it. */
const literalWrite = (raw: string, node: CstNode, write: typeof LF_WRITE | typeof CRLF_WRITE) =>
	fencedCodeWrite.normalize(raw, { node, mode: 'literal', lineEnding: write.lineEnding });

// The whole-raw entry point (the rule as a literal write), where the closer is put back: code
// writing bytes reaches a node's raw with the old metadata still attached, so a closer a truncation ate
// can be recovered there and nowhere later. `fenced-code-raw.test.ts` covers the display path
// (`reconcileFenceWrite`), which the editable element keeps a closer away from;
// `fenced-code-stranded-closer.test.ts` covers the other branch, for a write that took the opener.

const codeNode = (source: string): CstNode => parse(source).children[0];

/** What the bytes reparse to on their own: the reload the restored closer has to survive. */
function reload(raw: string) {
	const children = parse(raw).children;
	const first = children[0];
	return {
		count: children.length,
		closed: first.kind === 'fencedCode' && metadataOf(first, 'fencedCode').closed
	};
}

describe('the fence rule as a literal write: the dropped closer', () => {
	const closed = codeNode('```js\nbody\n```\n');

	it('re-appends the closer a truncating write dropped', () => {
		expect(literalWrite('```js\nbo\n', closed, LF_WRITE)).toBe('```js\nbo\n```\n');
		expect(reload(literalWrite('```js\nbo\n', closed, LF_WRITE))).toEqual({
			count: 1,
			closed: true
		});
	});

	it('is idempotent: a second pass finds the closer and declines', () => {
		const once = literalWrite('```js\nbo\n', closed, LF_WRITE);
		expect(literalWrite(once, closed, LF_WRITE)).toBe(once);
	});

	it('creates on the block’s own line ending (G4.20)', () => {
		const crlf = codeNode('```js\r\nbody\r\n```\r\n');
		expect(literalWrite('```js\r\nbo\r\n', crlf, CRLF_WRITE)).toBe('```js\r\nbo\r\n```\r\n');
		expect(reload(literalWrite('```js\r\nbo\r\n', crlf, CRLF_WRITE))).toEqual({
			count: 1,
			closed: true
		});
	});

	// An unterminated slice is what a last block without a trailing newline leaves behind: every
	// ending the rule writes, the restored closer's and the reattached one, is the fence's CRLF.
	it('creates CRLF onto an unterminated slice', () => {
		const crlf = codeNode('```js\r\nbody\r\n```\r\n');
		expect(literalWrite('```js\r\nbo', crlf, CRLF_WRITE)).toBe('```js\r\nbo\r\n```\r\n');
		expect(reload(literalWrite('```js\r\nbo', crlf, CRLF_WRITE))).toEqual({
			count: 1,
			closed: true
		});
	});

	it('copies the opener’s indent, which still closes at GFM’s 3-space limit', () => {
		const indented = codeNode('  ```js\n  body\n  ```\n');
		expect(literalWrite('  ```js\n  bo\n', indented, LF_WRITE)).toBe('  ```js\n  bo\n  ```\n');
		expect(reload(literalWrite('  ```js\n  bo\n', indented, LF_WRITE))).toEqual({
			count: 1,
			closed: true
		});
	});

	it('restores at the block’s own run length, leaving a shorter body run content', () => {
		const wide = codeNode('````js\n```\nbody\n````\n');
		expect(literalWrite('````js\n```\nbo\n', wide, LF_WRITE)).toBe('````js\n```\nbo\n````\n');
		expect(reload(literalWrite('````js\n```\nbo\n', wide, LF_WRITE))).toEqual({
			count: 1,
			closed: true
		});
	});

	// Which is why putting the closer back and growing the runs cannot both fire on a truncation:
	// growing triggers on a body line that reads as this fence's closer, and the restore reads it
	// as the closer.
	it('treats a body line that reads as the closer as the closer', () => {
		expect(literalWrite('```js\n```\nbo\n', closed, LF_WRITE)).toBe('```js\n```\nbo\n');
	});

	it('declines for a fence the metadata never closed', () => {
		const open = codeNode('```js\nbody\n');
		expect(literalWrite('```js\nbo\n', open, LF_WRITE)).toBe('```js\nbo\n');
	});
});
