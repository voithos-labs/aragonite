// A byte splice inside a long list, quote or table reads only the children its change reaches:
// the bytes it parses, the children its commit joins and compares, and the lines it pairs to put
// the caret down, are the same at N and 4N.
import { describe, it, expect, afterEach } from 'vitest';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { serialize } from '#lib/core/serializer.js';
import { assignChildIdsDeep } from '#lib/block-id.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { spliceReading } from '#lib/tree-operations/byte-splice.js';
import type { ByteChange } from '#lib/tree-operations/byte-changes.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

const N = 2000;

/** Child `i`'s text, the same length at every size. */
const word = (i: number) => `word ${String(i).padStart(6, '0')}`;

/** Each container `n` children long, the source line child `c` starts on, and what a paste of two
 *  lines at a child's end writes there. */
const SHAPES = {
	list: {
		source: (n: number) => Array.from({ length: n }, (_, i) => `- ${word(i)}\n`).join(''),
		line: (c: number) => c,
		pasted: 'one\n  two'
	},
	quote: {
		source: (n: number) => Array.from({ length: n }, (_, i) => `> ${word(i)}\n>\n`).join(''),
		line: (c: number) => 2 * c,
		pasted: 'one\n> two'
	},
	table: {
		source: (n: number) =>
			'| a | b |\n| --- | --- |\n' +
			Array.from({ length: n }, (_, i) => `| ${word(i)} | x |\n`).join(''),
		line: (c: number) => c + 1,
		pasted: 'one two'
	}
};

const lineStart = (source: string, line: number) => {
	let at = 0;
	for (let i = 0; i < line; i++) at = source.indexOf('\n', at) + 1;
	return at;
};

/** The middle child's paste, or a removal from three characters into it down three children. */
function changeAt(
	shape: keyof typeof SHAPES,
	source: string,
	n: number,
	edit: 'paste' | 'removal'
) {
	const { line, pasted } = SHAPES[shape];
	const c = n >> 1;
	if (edit === 'paste') {
		const end = source.indexOf(shape === 'table' ? ' | x |' : '\n', lineStart(source, line(c)));
		return { from: end, to: end, insert: pasted };
	}
	return {
		from: lineStart(source, line(c)) + 3,
		to: lineStart(source, line(c + 3)) + 3,
		insert: ''
	};
}

/** What the splice's read parses, then what its commit parses and joins. */
async function cost(shape: keyof typeof SHAPES, n: number, edit: 'paste' | 'removal') {
	const { deps } = makeEditorActionsDeps(SHAPES[shape].source(n));
	// Every container the editor opens carries its children's ids.
	for (const block of deps.doc.children) assignChildIdsDeep(block);
	const before = serialize(deps.doc);
	const changes: ByteChange[] = [changeAt(shape, before, n, edit)];
	enablePerfInstruments();
	resetPerfInstruments();
	spliceReading(deps.doc, before, changes, deps.reading.grammar);
	const read = perfSnapshot().parseBytes;
	resetPerfInstruments();
	const wrote = await createUndoController(deps).commitSource({
		changes,
		caret: { at: changes[0].from + changes[0].insert.length, holds: 'text' },
		op: { kind: 'paste', detail: { count: 1 } },
		snapshot: { path: docPathFrom([0]), offset: 0 }
	});
	expect(wrote).toBe(true);
	const { parseBytes, joinedChildReads, siblingsCompared, linesPaired } = perfSnapshot();
	return {
		read,
		commit: parseBytes,
		joined: joinedChildReads,
		compared: siblingsCompared,
		paired: linesPaired
	};
}

afterEach(() => disablePerfInstruments());

describe('a byte splice inside a long container', () => {
	for (const shape of ['list', 'quote', 'table'] as const) {
		for (const edit of ['paste', 'removal'] as const) {
			it(`reads the same few children at N and 4N: a ${edit} in a ${shape}`, async () => {
				const small = await cost(shape, N, edit);
				const large = await cost(shape, 4 * N, edit);
				expect(small.read).toBeGreaterThan(0);
				expect(small.read).toBeLessThan(400);
				expect(large).toEqual(small);
				expect(small.commit).toBe(small.read);
				expect(small.joined).toBe(0);
			});
		}
	}
});
