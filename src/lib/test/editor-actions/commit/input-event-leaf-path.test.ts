import { describe, it, expect, vi, afterEach } from 'vitest';
import { nodeAt } from '$lib/tree-operations/node-ops';
import { lrdMapCouldChange } from '$lib/components/lrd-map-gate';
import { UNDO_DEBOUNCE_MS } from '$lib/editor-actions/commit/text-batch';
import { makeNestedHarness } from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';

// The observable stake for the leaf path: `lrdMapCouldChange` resolves the event path,
// so a container-level path hides a nested definition edit from the map rebuild.

function makeNestedTyping(source: string) {
	const { deps, events, bundle } = makeNestedHarness(source, { index: 0 });
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
