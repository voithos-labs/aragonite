import { describe, it, expect } from 'vitest';
import {
	reconcileFenceWrite,
	type FenceShape,
	type FenceWriteMode
} from '$lib/schema/fenced-code-raw';

// The one write path every route shares: the display path, pasting, and the code that reaches a
// node's raw with no editable element. It covers what the block's syntax can hold once an edit has
// landed in a content region; where an edit may land is code-fence-boundary's subject.

const backtick = (length = 3, closed = true): FenceShape => ({ marker: '`', length, closed });

function write(display: string, fence: FenceShape, mode: FenceWriteMode = 'authored', caret = 0) {
	return reconcileFenceWrite({ display, caret, fence, mode, ending: '\n' });
}

describe('reconcileFenceWrite: escalation', () => {
	// Parser-verified: "```js\n```\nconst x = 1\n```" parses as three blocks, the last
	// of which swallows everything after the code block.
	it('grows both runs past a body line the parser would read as the closer', () => {
		expect(write('```js\n```\nconst x = 1\n```', backtick()).display).toBe(
			'````js\n```\nconst x = 1\n````'
		);
	});

	it('grows past the longest colliding body line, not the first', () => {
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
	it('lets an authored write close an open fence, and a literal one grow it', () => {
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

describe('reconcileFenceWrite: info-string sanitization', () => {
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

	it('leaves a tilde fence info string alone: GFM allows backticks there', () => {
		const display = '~~~y`ml\ncode\n~~~';
		expect(write(display, { marker: '~', length: 3, closed: true }).display).toBe(display);
	});

	// The marker run of an open fence is editable content (crossesFenceBoundary), and
	// typing a fourth backtick there widens the fence the user is still authoring.
	it('leaves an open fence opener alone', () => {
		expect(write('````js\ncode', backtick(3, false), 'authored').display).toBe('````js\ncode');
	});

	// The exemption belongs to the user typing; a plain write to an open fence is code writing
	// content, and the backtick it lands turns the block into a paragraph.
	it('drops a backtick a literal write lands in an open fence’s info string', () => {
		expect(write('```j`s\ncode', backtick(3, false), 'literal').display).toBe('```js\ncode');
	});
});

// Typed edits reach the fence lines where the mode paints them, so the typed path keeps one opener
// and one closer too: a fence line left alone would read every block below as its body.
describe('reconcileFenceWrite: a typed edit keeps one opener and one closer', () => {
	it('drops the closer an edit to the opener stranded', () => {
		expect(write('js\ncode\n```', backtick()).display).toBe('js\ncode');
	});

	it('puts back a closer an edit removed', () => {
		expect(write('```js', backtick()).display).toBe('```js\n```');
	});

	it('leaves a closed fence whose closer is gone', () => {
		const display = '```js\n```\ncode';
		expect(write(display, backtick()).display).toBe(display);
	});
});

describe('reconcileFenceWrite: a CRLF display', () => {
	const toCrlf = (text: string) => text.replace(/\n/g, '\r\n');
	/** Where `offset` in an LF display lands once every break before it is CRLF. */
	const crlfOffset = (lf: string, offset: number) =>
		offset + (lf.slice(0, offset).match(/\n/g)?.length ?? 0);

	// Each row moves the caret, so a `\r` counted on the wrong side of an offset shows up.
	const rows: Array<[string, string, number]> = [
		['a caret past the grown closer run', '```js\n```\ncode\n```', 18],
		['a caret at the start of the closer line', '```js\n```\ncode\n```', 15],
		['a caret on the colliding body line', '```js\n```\ncode\n```', 9],
		['a caret past a dropped info backtick', '```j`s\ncode\n```', 5],
		['a caret before a closer the write ran into', '```\nAB```', 6],
		['a caret inside a closer the write ran into', '```\nAB```', 7]
	];

	it.each(rows)('%s writes the CRLF mirror of the LF result', (_name, display, caret) => {
		const lf = write(display, backtick(), 'authored', caret);
		const crlf = write(toCrlf(display), backtick(), 'authored', crlfOffset(display, caret));
		expect(crlf).toEqual({ display: toCrlf(lf.display), caret: crlfOffset(lf.display, lf.caret) });
	});
});
