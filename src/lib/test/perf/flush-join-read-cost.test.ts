// Miss-analysis: the join a same-kind keystroke asks was costed by the perf gate's wall clock only,
// so nothing said how many of a flush neighbour's bytes one keystroke parses.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CstNode } from '$lib/core/nodes';
import { documentLineEnding } from '$lib/core/lines';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createLeafTyping } from '$lib/editor-actions/leaf-write';
import { legalizeWrite, type WriteTarget } from '$lib/tree-operations/content-write';
import { blockNodeAt } from '$lib/tree-operations/node-primitives';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '$lib/perf/instruments';

const lines = (line: (i: number) => string): string =>
	Array.from({ length: 5000 }, (_, i) => line(i)).join('');
const LIST = lines((i) => `- item ${i}\n`);
const FIRST_ITEM = '- item 0\n';
/** Big neighbours whose first line doesn't cut a paragraph off, so only the block above decides. */
const BELOW_A_HEADING: [string, string][] = [
	['a 5,000-row table', `| a | b |\n| - | - |\n${lines((i) => `| ${i} | x |\n`)}`],
	['a 5,000-item list starting at 2', lines((i) => `${i + 2}. item\n`)],
	['a 50 KB paragraph', 'words in a long paragraph\n'.repeat(1925)]
];

/** The bytes each of `raws` parses, written into the leaf at `leaf` through the keystroke route. */
function bytesPerKeystroke(source: string, leaf: number[], raws: string[]): number[] {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createLeafTyping(deps, createUndoController(deps));
	enablePerfInstruments();
	return raws.map((raw) => {
		const owner = leaf.length > 1 ? (blockNodeAt(deps.doc, leaf.slice(0, -1)) as CstNode) : null;
		const target: WriteTarget = owner
			? { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) }
			: deps.doc;
		const write = legalizeWrite(target, leaf[leaf.length - 1], raw, 'authored');
		resetPerfInstruments();
		expect(typing.writeLeafInPlace(docPathFrom(leaf), write, 0).wrote).toBe(true);
		return perfSnapshot().parseBytes;
	});
}

beforeEach(() => resetPerfInstruments());
afterEach(() => disablePerfInstruments());

describe('a same-kind keystroke parses the block below one line deep, and a flush one above whole', () => {
	it('reads one line of a long list flush below the written paragraph', () => {
		const raws = ['foox\n', 'fooxy\n'];
		const read = bytesPerKeystroke(`foo\n${LIST}`, [0], raws);

		// At most the paragraph's own reparse, then the paragraph and the list's first line together.
		read.forEach((bytes, i) => {
			expect(bytes).toBeLessThanOrEqual(2 * raws[i].length + FIRST_ITEM.length);
		});
	});

	it.each(BELOW_A_HEADING)('reads one line of %s flush below the written heading', (_, below) => {
		const raws = ['# hx\n', '# hxy\n'];
		const read = bytesPerKeystroke(`# h\n${below}`, [0], raws);
		const firstLine = below.slice(0, below.indexOf('\n') + 1);

		// The heading's own reparse, then the heading and the neighbour's first line together.
		expect(read).toEqual(raws.map((raw) => 2 * raw.length + firstLine.length));
	});

	it('reads the whole list flush above the written heading, once a keystroke', () => {
		const raws = ['# hx\n', '# hxy\n'];
		const read = bytesPerKeystroke(`${LIST}# h\n`, [1], raws);

		// The heading's own reparse, then the list whole with the heading's first line.
		expect(read).toEqual(raws.map((raw) => 2 * raw.length + LIST.length));
	});

	it('reads nothing above the document’s first block, and one line of the list a blank line below', () => {
		const raws = ['foox\n', 'fooxy\n'];
		const read = bytesPerKeystroke(`foo\n\n${LIST}`, [0], raws);

		expect(read).toEqual(raws.map((raw) => 2 * raw.length + '\n'.length + FIRST_ITEM.length));
	});

	it('reads nothing above a list item’s first paragraph, and one line of its sublist below', () => {
		const raws = ['firstx\n', 'firstxy\n'];
		const sublist = LIST.replace(/^/gm, '  ');
		const read = bytesPerKeystroke(`- first\n\n${sublist}`, [0, 0, 0], raws);

		// The list and item rebuilds read their first line, and the join below one line of the sublist.
		read.forEach((bytes) => expect(bytes).toBeLessThan(100));
	});
});
