// A byte splice that writes no opener parses nothing past its own read for the closers it would
// need, in a long body and inside one long list, where the read takes in the whole list.
import { describe, it, expect, afterEach } from 'vitest';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { serialize } from '#lib/core/serializer.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { spliceReading } from '#lib/tree-operations/byte-splice.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

const COUNT = 2000;
const BODY = Array.from({ length: COUNT }, (_, i) => `paragraph ${i}\n`).join('\n');
const LIST = Array.from({ length: COUNT }, (_, i) => `- item ${i}\n`).join('');

/** The bytes the splice's read parses for an insert at `at`, and the bytes its commit parses. */
async function parsed(source: string, at: number, insert: string) {
	const { deps } = makeEditorActionsDeps(source);
	const changes = [{ from: at, to: at, insert }];
	enablePerfInstruments();
	resetPerfInstruments();
	spliceReading(deps.bytes.measured(), serialize(deps.doc), changes, deps.reading.grammar);
	const read = perfSnapshot().parseBytes;
	resetPerfInstruments();
	const wrote = await createUndoController(deps).commitSource({
		changes,
		caret: { at: at + insert.length, holds: 'text' },
		op: { kind: 'input' },
		snapshot: { path: docPathFrom([0]), offset: 0 }
	});
	expect(wrote).toBe(true);
	return { read, commit: perfSnapshot().parseBytes };
}

afterEach(() => disablePerfInstruments());

describe('a byte splice writing prose', () => {
	it.each([
		['a paragraph of a long body', BODY, BODY.indexOf(`paragraph ${COUNT / 2}`) + 9],
		['an item of a long list', LIST, LIST.indexOf(`item ${COUNT / 2}`) + 4]
	])('in %s parses only what its read parses', async (_, source, at) => {
		const { read, commit } = await parsed(source, at, 'x');
		expect(read).toBeGreaterThan(0);
		expect(commit).toBe(read);
	});
});
