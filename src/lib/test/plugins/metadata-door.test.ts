// A plugin container's `updateOwnMetadata` is the parent's `updateBlockMetadata`, so reading mode
// refuses it at the commit like every other write, with the dev warning naming the operation.
// Miss-analysis: `updateOwnMetadata` is handed straight to plugin components, and no test drove
// that plugin-facing write in reading mode (GH #38).
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import { configureEditorEnv } from '$lib/env';
import type { PresentationMode } from '$lib/presentation-mode';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';
import { makeTopHarness } from '$lib/test/harness/editor-actions';
import { takeDevWarns } from '$lib/test/support/warn-gate';

const SOURCE = '> [!NOTE]\n> body\n';

function editorIn(mode: PresentationMode) {
	return makeTopHarness(SOURCE, { reading: fixtureReading({}, mode) });
}

describe('a metadata write in reading mode', () => {
	it('is declined at the commit with no undo entry or edit event, and a dev build names it', async () => {
		const editor = editorIn('reading');

		await editor.actions.updateBlockMetadata(0, { calloutType: 'warning' });

		expect(serialize(editor.doc)).toBe(SOURCE);
		expect(editor.deps.undoManager.canUndo).toBe(false);
		expect(editor.edits).toEqual([]);
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
		expect(fires[0].message).toContain("declined 'metadataUpdate' in reading mode");
	});

	it('stays silent in production while still declining', async () => {
		configureEditorEnv({ isDev: false, isTest: false });
		const editor = editorIn('reading');

		await editor.actions.updateBlockMetadata(0, { calloutType: 'warning' });

		expect(serialize(editor.doc)).toBe(SOURCE);
		expect(takeDevWarns()).toEqual([]);
	});

	// Scoped to reading, not "any non-source mode": preview and live modes edit.
	it('reaches the commit in a live preview mode', async () => {
		const editor = editorIn('preview-block');

		await editor.actions.updateBlockMetadata(0, { calloutType: 'warning' });

		expect(editor.edits.map((e) => e.op)).toEqual(['metadataUpdate']);
	});
});
