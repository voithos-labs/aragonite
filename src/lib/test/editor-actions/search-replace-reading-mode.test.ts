// Replace in reading mode: every commit in the batch is declined, so the batch reports nothing.
// Miss-analysis: every replace test ran in source mode, so no count was checked against a refusal.
import { describe, expect, it } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import type { EditEvent } from '#lib/editor-events.js';
import { READING_WRITE_TAG } from '#lib/editor-actions/commit/reading-write-gate.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { makeSearchReplace, scanCompiled } from '#lib/test/harness/search-replace.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

const SOURCE = 'one cat\n\ntwo cat\n';

describe('replace in reading mode', () => {
	it('writes nothing, pushes no undo entry, emits no edit event and applies nothing', async () => {
		const { deps, sr } = makeSearchReplace(SOURCE, { reading: fixtureReading({}, 'reading') });
		const edits: EditEvent[] = [];
		deps.events.on('edit', (e) => edits.push(e));

		const applied = await sr.replaceAll(scanCompiled(deps.doc, 'cat'), 'dog');

		expect(applied).toBe(0);
		expect(serialize(deps.doc)).toBe(SOURCE);
		expect(deps.undoManager.canUndo).toBe(false);
		expect(edits).toEqual([]);
		expect(takeDevWarns().every((w) => w.tag === READING_WRITE_TAG)).toBe(true);
	});
});
