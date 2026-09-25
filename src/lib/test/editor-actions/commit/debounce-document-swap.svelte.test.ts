// @vitest-environment jsdom
//
// A debounce timer surviving a `source` swap or an unmount fires `edit { op: 'input' }`
// carrying the old document's path against the document that replaced it. Asked of the
// mounted component on purpose: the batch could always be interrupted, but no lifecycle
// hook called it.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import {
	installLayoutStubs,
	mountEditor,
	destroyMountedEditors,
	typeInFirstBlock
} from '$lib/test/harness/mount-editor.svelte';
import { UNDO_DEBOUNCE_MS } from '$lib/editor-actions/commit/text-batch';
import type { EditEvent } from '$lib/editor-events';

beforeAll(installLayoutStubs);
afterEach(() => {
	void destroyMountedEditors();
	vi.useRealTimers();
});

function mountTracking(source: string) {
	const mounted = mountEditor({ source });
	const inputs: EditEvent[] = [];
	mounted.instance.getEvents().on('edit', (e) => {
		if (e.op === 'input') inputs.push(e);
	});
	return { ...mounted, inputs };
}

describe('the typing debounce is interrupted before the document it addresses goes away', () => {
	it('fires no input edit against the document that replaced the one typed in', async () => {
		const { props, target, inputs } = mountTracking('alpha\n\nbeta\n');
		vi.useFakeTimers();

		typeInFirstBlock(target, 'alpha!');
		await tick();
		expect(inputs).toHaveLength(0);

		props.source = 'gamma\n';
		flushSync();
		await tick();
		const flushedDuringSwap = inputs.length;

		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);

		// Whatever the swap chose to emit, the timer must contribute nothing after it.
		expect(inputs).toHaveLength(flushedDuringSwap);
		expect(flushedDuringSwap).toBe(1);
		expect(inputs[0].path).toEqual([0]);
	});

	// The flush emits `edit`, which the editor's own subscriber defers into a decoration
	// run: at teardown, against a getter closed over dead state.
	it('schedules no decoration work for the document it just tore down', async () => {
		const { instance: editor, target, inputs } = mountTracking('alpha\n\nbeta\n');
		const provided: number[] = [];
		editor.getDecorations().addSource({
			name: 'probe',
			provide: (doc) => {
				provided.push(doc.children.length);
				return [];
			}
		});
		vi.useFakeTimers();

		typeInFirstBlock(target, 'alpha!');
		await tick();
		const providedBeforeTeardown = provided.length;
		expect(providedBeforeTeardown, 'the probe source never ran at all').toBeGreaterThan(0);

		void destroyMountedEditors();
		flushSync();
		await tick();
		await tick();
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);
		await tick();
		await tick();

		expect(inputs).toHaveLength(1);
		expect(provided).toHaveLength(providedBeforeTeardown);
	});

	it('fires no input edit after the editor unmounts mid-batch', async () => {
		const { target, inputs } = mountTracking('alpha\n\nbeta\n');
		vi.useFakeTimers();

		typeInFirstBlock(target, 'alpha!');
		await tick();

		void destroyMountedEditors();
		flushSync();
		const flushedDuringTeardown = inputs.length;

		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);

		expect(inputs).toHaveLength(flushedDuringTeardown);
		expect(flushedDuringTeardown).toBe(1);
	});
});
