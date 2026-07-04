import { describe, it, expect, vi, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { nodeAt } from '$lib/tree-operations/node-ops';
import { lrdMapCouldChange } from '$lib/components/lrd-map-gate';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { UNDO_DEBOUNCE_MS } from '$lib/editor-actions/commit/text-batch';
import {
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps
} from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// The batched `input` event must carry the edited LEAF's doc-absolute path.
// A container-nested link-reference definition is the observable stake:
// `lrdMapCouldChange` resolves the event path, and a container-level path
// hides the definition edit from the map rebuild (stale resolver).

function makeNestedTyping(source: string) {
	const harness = makeEditorActionsDeps(parse(source).children);
	const { deps, events } = harness;
	const controller = createUndoController(deps);
	const bundle = createStandardNestedActions(
		createBlockListState(() => deps.doc.children[0]),
		{
			index: 0,
			get node() {
				return deps.doc.children[0];
			},
			path: [0],
			stickyColumn: makeStickyColumn(),
			parent: {
				blockEdit: makeStubBlockEdit(),
				focus: makeStubFocus(),
				containerEdit: createContainerEditActions(deps, controller)
			}
		}
	);
	const edits: EditEvent[] = [];
	events.on('edit', (e) => edits.push(e));
	return { deps, bundle, edits };
}

describe('batched input event carries the leaf path', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('typing in a container-nested LRD emits the leaf path and reopens the LRD gate', async () => {
		const h = makeNestedTyping('> [a]: /url\n');
		expect(h.deps.doc.children[0].children![0].kind).toBe('linkReferenceDefinition');

		vi.useFakeTimers();
		await h.bundle.blockEdit.updateBlockContent(0, '[a]: /url2\n', 9);
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);

		const input = h.edits.find((e) => e.op === 'input');
		expect(input).toBeDefined();
		expect(input!.path).toEqual([0, 0]);
		expect(nodeAt(h.deps.doc, input!.path)?.kind).toBe('linkReferenceDefinition');
		expect(lrdMapCouldChange(h.deps.doc, input!)).toBe(true);
	});

	it('typing in a container-nested paragraph still skips the LRD rebuild', async () => {
		const h = makeNestedTyping('> see [d][d]\n');

		vi.useFakeTimers();
		await h.bundle.blockEdit.updateBlockContent(0, 'see [d][d]!\n', 10);
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);

		const input = h.edits.find((e) => e.op === 'input');
		expect(input).toBeDefined();
		expect(input!.path).toEqual([0, 0]);
		expect(lrdMapCouldChange(h.deps.doc, input!)).toBe(false);
	});
});
