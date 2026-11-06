// A fence's reading waits on a closer only while nothing closes it; every closed shape is final.
import { describe, it, expect } from 'vitest';
import { fenceReading } from '#lib/core/parsers/fence-syntax.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';

describe('a fence reading that a line below could still change', () => {
	it.each([
		['an opener alone', '```\n'],
		['an opener with no line ending', '```'],
		['an opener and a body', '```js\ncode\n'],
		['a body ending in a blank line', '~~~\ncode\n\n'],
		['a closer shorter than the opener', '````\ncode\n```\n'],
		['a closer of the other marker', '```\ncode\n~~~\n']
	])('waits: %s', (_, raw) => {
		expect(fenceReading.notFinal(raw, defaultGrammarView)).toBe(true);
	});

	it.each([
		['a closed fence', '```\ncode\n```\n'],
		['a closer with no line ending', '```\ncode\n```'],
		['CRLF endings', '```\r\ncode\r\n```\r\n\r\n'],
		['a trailing blank line in the raw', '```\ncode\n```\n\n'],
		['a closer longer than the opener', '```\ncode\n`````\n'],
		['a closer indented three spaces', '```\ncode\n   ```\n'],
		['a tilde body holding a backtick line', '~~~\n```\n~~~\n'],
		['an info string', '```js title="a b"\ncode\n```\n'],
		['a paragraph', 'text\n'],
		['indented code', '    ```\n']
	])('is final: %s', (_, raw) => {
		expect(fenceReading.notFinal(raw, defaultGrammarView)).toBe(false);
	});

	it('may be closed only by a bare run of three or more markers', () => {
		expect(['```', '~~~~', '   ```  '].map(fenceReading.mayClose)).toEqual([true, true, true]);
		expect(['``', '```js', '    ```', 'text'].map(fenceReading.mayClose)).toEqual([
			false,
			false,
			false,
			false
		]);
	});
});
