import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createBlockEditActions } from '$lib/editor-actions/block-edit';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// Top-level/container event-path parity: both scopes emit the op's TARGET
// (the deleted neighbor for not-editable merges, the minted index for
// descend-mint) — the top-level scope no longer substitutes the snapshot index.

function makeTop(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(harness.deps);
	const actions = createBlockEditActions(harness.deps, controller);
	const edits: EditEvent[] = [];
	harness.events.on('edit', (e) => edits.push(e));
	return { deps: harness.deps, actions, edits };
}

describe('top-level event paths target the operated block', () => {
	it('backspace-merge into a non-editable previous block emits delete at the neighbor', async () => {
		const h = makeTop('---\n\ntext\n');
		await h.actions.mergeWithPrevious(1);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'delete', path: [0] });
	});

	it('forward-merge into a non-editable next block emits delete at the neighbor', async () => {
		const h = makeTop('text\n\n---\n');
		await h.actions.mergeWithNext(0);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'delete', path: [1] });
	});

	it('descendToBody minting a body paragraph emits appendBlock at the minted index', async () => {
		const h = makeTop('Title\n');
		await h.actions.descendToBody(0);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0]).toMatchObject({ op: 'appendBlock', path: [1] });
	});

	it('a kind-changing updateBlockContent emits updateContent at the block', async () => {
		const h = makeTop('hello\n');
		await h.actions.updateBlockContent(0, '# hello\n', 0);
		const update = h.edits.find((e) => e.op === 'updateContent');
		expect(update).toBeDefined();
		expect(update!.path).toEqual([0]);
	});
});
