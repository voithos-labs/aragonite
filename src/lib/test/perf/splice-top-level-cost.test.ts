// G4.340 at the byte splice: in a document of many small blocks whose starts the editor keeps, a
// splice reads the top-level blocks its windows hold, as many at 400 blocks as at 40.
// Miss-analysis: the splice cost rows ran inside one long container, so nothing counted the
// top-level blocks a splice summed to find where its bytes fall in a document of many.
import { afterEach, describe, expect, it } from 'vitest';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { serialize } from '#lib/core/serializer.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import type { ByteChange } from '#lib/tree-operations/byte-changes.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

afterEach(disablePerfInstruments);

const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}\n`).join('\n');

const lineAt = (source: string, i: number) => source.indexOf(`line ${i}\n`);

/** Each splice's changes to a document of `n` paragraphs, whose bytes are `source`. */
const SPLICES: Record<string, (source: string, n: number) => ByteChange[]> = {
	'a letter in one block': (source) => [
		{ from: lineAt(source, 3), to: lineAt(source, 3), insert: 'X' }
	],
	'a letter in each of two blocks far apart': (source, n) =>
		[3, n - 2].map((i) => ({ from: lineAt(source, i), to: lineAt(source, i), insert: 'X' })),
	'a removal across three blocks': (source) => [
		{ from: lineAt(source, 3) + 2, to: lineAt(source, 6) + 2, insert: '' }
	],
	'three paragraphs pasted into one': (source) => {
		const at = lineAt(source, 3) + 2;
		return [{ from: at, to: at, insert: 'one\n\ntwo\n\nthree' }];
	}
};

/** Top-level blocks measured over one splice commit in a document of `n` blocks. */
async function measuredOver(n: number, changesOf: (source: string, n: number) => ByteChange[]) {
	const { deps } = makeEditorActionsDeps(paragraphs(n));
	// Asked first, as any reader of a position leaves it, so the count is the splice's own.
	void deps.bytes.measured().starts.length;
	const changes = changesOf(serialize(deps.doc), n);
	enablePerfInstruments();
	resetPerfInstruments();
	const wrote = await createUndoController(deps).commitSource({
		changes,
		caret: { at: changes[0].from + changes[0].insert.length, holds: 'text' },
		op: { kind: 'paste', detail: { count: 1 } },
		snapshot: { path: docPathFrom([0]), offset: 0 }
	});
	expect(wrote).toBe(true);
	return perfSnapshot().topBlocksMeasured;
}

describe('G4.340 a byte splice in a document of many blocks', () => {
	it.each(Object.entries(SPLICES))(
		'%s reads as many blocks at 400 as at 40',
		async (_, changesOf) => {
			const small = await measuredOver(40, changesOf);
			expect(small).toBeLessThan(10);
			expect(await measuredOver(400, changesOf)).toBe(small);
		}
	);
});
