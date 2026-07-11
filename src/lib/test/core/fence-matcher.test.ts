import { describe, expect, it } from 'vitest';
import { matchFenceOpen, matchFenceClose } from '$lib/core/parsers/fenced-code';

// The matchers are re-exported on `aragonite/plugin` as the recognizer surface
// for fence-claiming openers, so their shape is pinned here directly — a
// byte-exact rebuild needs the verbatim `indent` and `infoRaw` alongside the
// trimmed `info` the built-in opener dispatches on.

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
