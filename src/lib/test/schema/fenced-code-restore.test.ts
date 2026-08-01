import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { normalizeFencedRaw } from '$lib/schema/fenced-code-raw';
import { metadataOf, type CstNode } from '$lib/core/nodes';

// The whole-raw door (`normalizeFencedRaw`), where RESTORE lives: the byte sinks reach a node's
// raw with the OLD metadata still attached, so a closer a truncation consumed is recoverable
// there and nowhere downstream. `fenced-code-raw.test.ts` covers the display funnel's door
// (`reconcileFenceWrite`), which the surface guard keeps a closer away from.

const codeNode = (source: string): CstNode => parse(source).children[0];

/** What the bytes reparse to on their own — the reload the restored closer has to survive. */
function reload(raw: string) {
	const children = parse(raw).children;
	const first = children[0];
	return {
		count: children.length,
		closed: first.kind === 'fencedCode' && metadataOf(first, 'fencedCode').closed
	};
}

describe('normalizeFencedRaw — the dropped closer', () => {
	const closed = codeNode('```js\nbody\n```\n');

	it('re-appends the closer a truncating write dropped', () => {
		expect(normalizeFencedRaw('```js\nbo\n', closed)).toBe('```js\nbo\n```\n');
		expect(reload(normalizeFencedRaw('```js\nbo\n', closed))).toEqual({ count: 1, closed: true });
	});

	it('is idempotent — a second pass finds the closer and declines', () => {
		const once = normalizeFencedRaw('```js\nbo\n', closed);
		expect(normalizeFencedRaw(once, closed)).toBe(once);
	});

	it('mints on the block’s own line ending (G4.20)', () => {
		const crlf = codeNode('```js\r\nbody\r\n```\r\n');
		expect(normalizeFencedRaw('```js\r\nbo\r\n', crlf)).toBe('```js\r\nbo\r\n```\r\n');
		expect(reload(normalizeFencedRaw('```js\r\nbo\r\n', crlf))).toEqual({
			count: 1,
			closed: true
		});
	});

	// An unterminated slice is what a last block without a trailing newline leaves behind: the
	// reattached ending falls back to LF, so reading the closer's ending off it downgrades a
	// CRLF block.
	it('mints CRLF onto an unterminated slice', () => {
		const crlf = codeNode('```js\r\nbody\r\n```\r\n');
		expect(normalizeFencedRaw('```js\r\nbo', crlf)).toBe('```js\r\nbo\r\n```\n');
		expect(reload(normalizeFencedRaw('```js\r\nbo', crlf))).toEqual({ count: 1, closed: true });
	});

	it('copies the opener’s indent, which still closes at GFM’s 3-space limit', () => {
		const indented = codeNode('  ```js\n  body\n  ```\n');
		expect(normalizeFencedRaw('  ```js\n  bo\n', indented)).toBe('  ```js\n  bo\n  ```\n');
		expect(reload(normalizeFencedRaw('  ```js\n  bo\n', indented))).toEqual({
			count: 1,
			closed: true
		});
	});

	it('restores at the block’s own run length, leaving a shorter body run content', () => {
		const wide = codeNode('````js\n```\nbody\n````\n');
		expect(normalizeFencedRaw('````js\n```\nbo\n', wide)).toBe('````js\n```\nbo\n````\n');
		expect(reload(normalizeFencedRaw('````js\n```\nbo\n', wide))).toEqual({
			count: 1,
			closed: true
		});
	});

	// Which is why RESTORE and ESCALATE cannot co-fire on a truncation: escalation triggers on
	// a body line that reads as this fence's closer, and RESTORE's probe reads it AS the closer.
	it('treats a body line that reads as the closer as the closer', () => {
		expect(normalizeFencedRaw('```js\n```\nbo\n', closed)).toBe('```js\n```\nbo\n');
	});

	// The three shapes of "line 0 is not this block's opener". The rule restores the closer the
	// metadata still claims, and no metadata claims a block whose opener the write took — sizing
	// a run to the survivor would invent one the CST never had (issue #58).
	it('declines a tail cut below the opener', () => {
		expect(normalizeFencedRaw('dy\nmore\n', closed)).toBe('dy\nmore\n');
	});

	it('declines a stranded closer longer than the block’s own run', () => {
		const tilde = codeNode('~~~js\nbody\n~~~~~\n');
		expect(normalizeFencedRaw('~~~~~\n', tilde)).toBe('~~~~~\n');
	});

	it('declines a lone closer line, which reads as a closer and not as an opener', () => {
		const bare = codeNode('```\nbody\n```\n');
		expect(normalizeFencedRaw('```\n', bare)).toBe('```\n');
	});

	it('declines for a fence the metadata never closed', () => {
		const open = codeNode('```js\nbody\n');
		expect(normalizeFencedRaw('```js\nbo\n', open)).toBe('```js\nbo\n');
	});
});
