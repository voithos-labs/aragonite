import { describe, it, expect } from 'vitest';
import { scanLongestFenceRun } from '../../code-surface/code-renderer';

describe('scanLongestFenceRun', () => {
	it('returns 0 for text with no fence characters', () => {
		expect(scanLongestFenceRun('hello world', '`')).toBe(0);
		expect(scanLongestFenceRun('no tildes here', '~')).toBe(0);
	});

	it('returns the length of a single fence run', () => {
		expect(scanLongestFenceRun('some ``` code', '`')).toBe(3);
		expect(scanLongestFenceRun('~~~~ tildes', '~')).toBe(4);
	});

	it('returns the longest run when multiple are present', () => {
		expect(scanLongestFenceRun('``` short and ```` longer ```', '`')).toBe(4);
	});

	it('ignores the other fence character', () => {
		expect(scanLongestFenceRun('backticks ``` and tildes ~~~~', '`')).toBe(3);
		expect(scanLongestFenceRun('backticks ``` and tildes ~~~~', '~')).toBe(4);
	});

	it('handles a run at the start of text', () => {
		expect(scanLongestFenceRun('```js\nconst x = 1\n```', '`')).toBe(3);
	});

	it('handles a run at the end of text', () => {
		expect(scanLongestFenceRun('const x = 1\n```', '`')).toBe(3);
	});

	it('handles an empty string', () => {
		expect(scanLongestFenceRun('', '`')).toBe(0);
	});

	it('handles a single character', () => {
		expect(scanLongestFenceRun('`', '`')).toBe(1);
	});

	it('counts inline code single backticks as runs of length 1', () => {
		expect(scanLongestFenceRun('see `foo` and `bar`', '`')).toBe(1);
	});
});
