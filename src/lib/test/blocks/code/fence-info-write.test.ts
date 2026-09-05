// The info-string write behind the language chip: everything outside that one span must
// come back byte-identical, and the span itself may not hold bytes that stop the line
// reading as this block's opener.
//
// Miss-analysis: nothing could have caught it — the write is new with the chip. The class
// it belongs to (a byte edit aimed at fence structure) was covered only where a keystroke
// could reach, and the chip reaches the one span no caret can land in.
import { describe, it, expect } from 'vitest';
import { writeFenceInfo, type FenceShape } from '$lib/schema/fenced-code-raw';

const backtick = (length = 3, closed = true): FenceShape => ({ marker: '`', length, closed });
const tilde = (length = 3, closed = true): FenceShape => ({ marker: '~', length, closed });

describe('writeFenceInfo rewrites the opener’s info span alone', () => {
	it('replaces an existing info string', () => {
		expect(writeFenceInfo('```js\nconst x = 1\n```', 'ts', backtick())).toBe(
			'```ts\nconst x = 1\n```'
		);
	});

	it('sets one where the fence had none', () => {
		expect(writeFenceInfo('```\nconst x = 1\n```', 'js', backtick())).toBe(
			'```js\nconst x = 1\n```'
		);
	});

	it('empties one', () => {
		expect(writeFenceInfo('```js\nconst x = 1\n```', '', backtick())).toBe('```\nconst x = 1\n```');
	});

	it('keeps a run longer than three', () => {
		expect(writeFenceInfo('````js\na```b\n````', 'ts', backtick(4))).toBe('````ts\na```b\n````');
	});

	it('keeps the opener’s indent', () => {
		expect(writeFenceInfo('   ```js\nconst x = 1\n   ```', 'ts', backtick())).toBe(
			'   ```ts\nconst x = 1\n   ```'
		);
	});

	it('writes a tilde fence the same way', () => {
		expect(writeFenceInfo('~~~js\nconst x = 1\n~~~', 'ts', tilde())).toBe(
			'~~~ts\nconst x = 1\n~~~'
		);
	});

	it('writes an unclosed fence, which has no closer to reconcile', () => {
		expect(writeFenceInfo('```js\nconst x = 1', 'ts', backtick(3, false))).toBe(
			'```ts\nconst x = 1'
		);
	});

	// The seam appends the block's own trailing ending after this write, so a mangled one
	// here would double it or drop it.
	it('leaves a trailing blank line where it found it', () => {
		expect(writeFenceInfo('```js\nconst x = 1\n```\n', 'ts', backtick())).toBe(
			'```ts\nconst x = 1\n```\n'
		);
	});

	it('keeps a CRLF separator whole', () => {
		expect(writeFenceInfo('```js\r\nconst x = 1\r\n```', 'ts', backtick())).toBe(
			'```ts\r\nconst x = 1\r\n```'
		);
	});

	it('writes a multi-token info string verbatim', () => {
		expect(writeFenceInfo('```js\nx\n```', 'ts title=main', backtick())).toBe(
			'```ts title=main\nx\n```'
		);
	});
});

describe('writeFenceInfo refuses what the info span cannot hold', () => {
	it('drops a backtick under a backtick fence', () => {
		expect(writeFenceInfo('```js\nx\n```', 'a`b', backtick())).toBe('```ab\nx\n```');
	});

	// The display funnel's own sanitize pass stands down on an authored open fence, so this
	// arm is the only thing between the chip and a block that stops parsing as one.
	it('drops it on an unclosed backtick fence too', () => {
		expect(writeFenceInfo('```js\nx', 'a`b', backtick(3, false))).toBe('```ab\nx');
	});

	it('keeps a backtick under a tilde fence, where GFM allows it', () => {
		expect(writeFenceInfo('~~~js\nx\n~~~', 'a`b', tilde())).toBe('~~~a`b\nx\n~~~');
	});

	it('drops a leading run of the fence’s own marker, which would lengthen the fence', () => {
		expect(writeFenceInfo('~~~js\nx\n~~~', '~~x', tilde())).toBe('~~~x\nx\n~~~');
	});

	it('keeps the fence’s marker where it is not leading', () => {
		expect(writeFenceInfo('~~~js\nx\n~~~', 'x~y', tilde())).toBe('~~~x~y\nx\n~~~');
	});

	it('flattens a newline the field could never show', () => {
		expect(writeFenceInfo('```js\nx\n```', 'a\nb', backtick())).toBe('```ab\nx\n```');
	});

	it('declines when line 0 is not this block’s opener', () => {
		expect(writeFenceInfo('const x = 1\n```', 'ts', backtick())).toBeNull();
	});
});
