import { describe, it, expect } from 'vitest';
import {
	reconcileFenceWrite,
	type FenceShape,
	type FenceWriteMode
} from '$lib/schema/fenced-code-raw';

// The write seam every route shares — the display funnel, the paste surface, and the byte
// sinks that reach a node's raw without a surface: what the block's grammar can hold once
// an edit has landed in a content region. Where an edit may land is code-fence-boundary's.

const backtick = (length = 3, closed = true): FenceShape => ({ marker: '`', length, closed });

function write(display: string, fence: FenceShape, mode: FenceWriteMode = 'authored', caret = 0) {
	return reconcileFenceWrite({ display, caret, fence, mode });
}

describe('reconcileFenceWrite — escalation', () => {
	// Parser-verified: "```js\n```\nconst x = 1\n```" parses as three blocks, the last
	// of which swallows everything after the code block.
	it('grows both runs past a body line the parser would read as the closer', () => {
		expect(write('```js\n```\nconst x = 1\n```', backtick()).display).toBe(
			'````js\n```\nconst x = 1\n````'
		);
	});

	it('grows past the LONGEST colliding body line, not the first', () => {
		expect(write('```\n```\n`````\n```', backtick()).display).toBe('``````\n```\n`````\n``````');
	});

	it('leaves a run that is not a whole line alone', () => {
		const display = '```\nfoo```bar\n`` `\n```';
		expect(write(display, backtick()).display).toBe(display);
	});

	it('leaves an already-wide fence alone (the rule is a floor, and idempotent)', () => {
		const once = write('```js\n```\ncode\n```', backtick()).display;
		const twice = write(once, backtick(4)).display;
		expect(twice).toBe(once);
	});

	it('preserves the opener indent and the info string', () => {
		expect(write('  ```js\n```\ncode\n  ```', backtick()).display).toBe(
			'  ````js\n```\ncode\n  ````'
		);
	});

	it('grows a tilde fence on its own marker only', () => {
		expect(write('~~~\n~~~\ncode\n~~~', { marker: '~', length: 3, closed: true }).display).toBe(
			'~~~~\n~~~\ncode\n~~~~'
		);
		const withBackticks = '~~~\n```\ncode\n~~~';
		expect(write(withBackticks, { marker: '~', length: 3, closed: true }).display).toBe(
			withBackticks
		);
	});

	// Typing a closer is how an open fence is ended by hand; escalating there would
	// make that gesture impossible. A paste is content by contract, so it still grows.
	it('lets an AUTHORED write close an open fence, and a LITERAL one grow it', () => {
		const open = '```\ncode\n```';
		expect(write(open, backtick(3, false), 'authored').display).toBe(open);
		expect(write(open, backtick(3, false), 'literal').display).toBe('````\ncode\n```');
	});

	it('moves a caret past each run it grows', () => {
		// "```js\n```\ncode\n```", caret at the end of the colliding body line (9).
		expect(write('```js\n```\ncode\n```', backtick(), 'authored', 9).caret).toBe(10);
		// A caret inside the opener run does not move; one past the closer run moves twice.
		expect(write('```js\n```\ncode\n```', backtick(), 'authored', 1).caret).toBe(1);
		expect(write('```js\n```\ncode\n```', backtick(), 'authored', 18).caret).toBe(20);
	});
});

describe('reconcileFenceWrite — info-string sanitization', () => {
	// Parser-verified: "```j`s\nconst x = 1\n```" demotes the block and promotes its
	// closer to an absorbing opener. No fence length can hold the character.
	it('drops a backtick typed into a backtick fence info string', () => {
		expect(write('```j`s\ncode\n```', backtick(), 'authored', 5).display).toBe('```js\ncode\n```');
	});

	it('pulls the caret back past each dropped character', () => {
		expect(write('```j`s\ncode\n```', backtick(), 'authored', 5).caret).toBe(4);
		expect(write('```j`s\ncode\n```', backtick(), 'authored', 3).caret).toBe(3);
	});

	// A backtick typed at the head of the info string reads as a longer opener run
	// once written, and a longer opener no longer matches its own closer.
	it('drops one typed at the run boundary rather than reading it as a longer run', () => {
		expect(write('````js\ncode\n```', backtick(), 'authored', 4).display).toBe('```js\ncode\n```');
	});

	it('drops every backtick a paste carries into the info string', () => {
		expect(write('```j``s\ncode\n```', backtick(), 'literal', 7).display).toBe('```js\ncode\n```');
	});

	it('leaves a tilde fence info string alone — GFM allows backticks there', () => {
		const display = '~~~y`ml\ncode\n~~~';
		expect(write(display, { marker: '~', length: 3, closed: true }).display).toBe(display);
	});

	// The marker run of an open fence is editable content (crossesFenceBoundary), and
	// typing a fourth backtick there widens the fence the user is still authoring.
	it('leaves an OPEN fence opener alone', () => {
		expect(write('````js\ncode', backtick(3, false), 'authored').display).toBe('````js\ncode');
	});

	// The authoring exemption is the AUTHOR's; a literal write to an open fence is a sink
	// writing content, and the backtick it lands demotes the block to a paragraph.
	it('drops a backtick a LITERAL write lands in an open fence’s info string', () => {
		expect(write('```j`s\ncode', backtick(3, false), 'literal').display).toBe('```js\ncode');
	});
});

describe('reconcileFenceWrite — declines what it cannot read', () => {
	it('leaves a display whose opener is not this block’s fence shape', () => {
		const display = 'js\ncode\n```';
		expect(write(display, backtick()).display).toBe(display);
	});

	it('leaves a closed fence whose closer is gone', () => {
		const display = '```js\n```\ncode';
		expect(write(display, backtick()).display).toBe(display);
	});

	it('leaves an opener-only display', () => {
		expect(write('```js', backtick()).display).toBe('```js');
	});
});
