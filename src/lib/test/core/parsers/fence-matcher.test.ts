import { describe, expect, it } from 'vitest';
import {
	matchFenceOpen,
	matchFenceClose,
	escalatedFenceLength
} from '$lib/core/parsers/fence-syntax';

// Re-exported on `aragonite/plugin`, so the shape is pinned directly: a byte-exact rebuild
// needs verbatim `indent` and `infoRaw` alongside the trimmed `info` openers dispatch on.

describe('matchFenceOpen', () => {
	it('recognizes a backtick fence with trimmed info', () => {
		expect(matchFenceOpen('```mermaid theme=dark ')).toMatchObject({
			marker: '`',
			length: 3,
			info: 'mermaid theme=dark'
		});
	});

	it('captures indent and infoRaw verbatim for byte-exact rebuilds', () => {
		expect(matchFenceOpen('   ~~~~ graph  ')).toMatchObject({
			marker: '~',
			length: 4,
			indent: '   ',
			infoRaw: ' graph  ',
			info: 'graph'
		});
		expect(matchFenceOpen('```js')).toMatchObject({ indent: '', infoRaw: 'js' });
	});

	const declined: Array<[label: string, line: string]> = [
		['a backtick info string containing backticks', '```js `code`'],
		['a two-character run', '``'],
		['a four-space-indented line (indented code)', '    ```js'],
		['plain prose', 'not a fence']
	];
	for (const [label, line] of declined) {
		it(`declines ${label}`, () => {
			expect(matchFenceOpen(line)).toBeNull();
		});
	}

	it('allows backticks in a tilde fence info string', () => {
		expect(matchFenceOpen('~~~js `code`')).toMatchObject({ marker: '~', info: 'js `code`' });
	});
});

describe('matchFenceClose', () => {
	it('accepts a closer run >= the opener length, trailing spaces allowed', () => {
		expect(matchFenceClose('```', '`', 3)).toBe(true);
		expect(matchFenceClose('   `````  ', '`', 3)).toBe(true);
		expect(matchFenceClose('~~~~', '~', 4)).toBe(true);
	});

	const declined: Array<[label: string, line: string, marker: '`' | '~', min: number]> = [
		['a shorter run', '```', '`', 4],
		['the other marker', '~~~', '`', 3],
		['a closer with an info string', '``` js', '`', 3],
		['a four-space-indented closer', '    ```', '`', 3]
	];
	for (const [label, line, marker, min] of declined) {
		it(`declines ${label}`, () => {
			expect(matchFenceClose(line, marker, min)).toBe(false);
		});
	}
});

// The write-side inverse — what a body forces the fence to grow to — and the sibling of
// `escalatedColonCount` for directives.
describe('escalatedFenceLength', () => {
	it('returns the minimum when no body line reproduces the terminator', () => {
		expect(escalatedFenceLength('const x = 1\nfoo```bar', '`', 3)).toBe(3);
	});

	it('grows one past a body line the parser would read as the closer', () => {
		expect(escalatedFenceLength('```', '`', 3)).toBe(4);
		expect(escalatedFenceLength('code\n   ``` \nmore', '`', 3)).toBe(4);
	});

	it('grows past the LONGEST collision, scanning every line', () => {
		expect(escalatedFenceLength('```\n`````\n````', '`', 3)).toBe(6);
	});

	it('never shortens: the minimum is a floor', () => {
		expect(escalatedFenceLength('```', '`', 6)).toBe(6);
	});

	it('counts only the block’s own marker', () => {
		expect(escalatedFenceLength('~~~~~', '`', 3)).toBe(3);
		expect(escalatedFenceLength('~~~~~', '~', 3)).toBe(6);
	});

	it('reads a CRLF body line without its carriage return', () => {
		expect(escalatedFenceLength('code\r\n```\r\nmore', '`', 3)).toBe(4);
	});

	it('declines a four-space-indented run, as the parser does', () => {
		expect(escalatedFenceLength('    ```', '`', 3)).toBe(3);
	});
});
