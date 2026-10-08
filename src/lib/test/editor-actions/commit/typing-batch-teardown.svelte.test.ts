// @vitest-environment jsdom
// Typing's `edit` fires at the keystroke, so an editor that unmounts mid-batch has nothing left to
// report: its pause timer must fire nothing and schedule nothing for the document it tore down.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import {
	installLayoutStubs,
	mountEditor,
	destroyMountedEditors,
	typeInFirstBlock
} from '#lib/test/harness/mount-editor.svelte.js';
import { UNDO_DEBOUNCE_MS } from '#lib/editor-actions/commit/text-batch.js';
import type { EditEvent } from '#lib/editor-events.js';

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

describe('an editor unmounted inside the typing pause', () => {
	// A decoration run at teardown would read a getter closed over dead state.
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

	it('fires no input edit after the editor unmounts', async () => {
		const { target, inputs } = mountTracking('alpha\n\nbeta\n');
		vi.useFakeTimers();

		typeInFirstBlock(target, 'alpha!');
		await tick();

		expect(inputs).toHaveLength(1);

		void destroyMountedEditors();
		flushSync();
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);

		expect(inputs).toHaveLength(1);
	});
});
