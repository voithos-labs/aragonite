// @vitest-environment jsdom
//
// The typing debounce is broken by pauses, batch-key changes, structural commits
// and history swaps — but nothing broke it when the host swapped the `source`
// prop or unmounted the editor. A timer surviving either fired
// `edit { op: 'input' }` carrying the OLD document's path against the document
// that replaced it, so the first downstream consumer (autosave keyed on `edit`)
// saw a phantom keystroke in a note the user never touched.
//
// Asked of the mounted component on purpose: the batch itself was always
// interruptible: the defect was that no lifecycle seam called it.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import Editor from '$lib/components/Editor.svelte';
import { UNDO_DEBOUNCE_MS } from '$lib/editor-actions/commit/text-batch';
import type { EditEvent } from '$lib/editor-events';
import type { EditorInstance } from '$lib/editor-props';

beforeAll(() => {
	(globalThis as any).ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
	Element.prototype.scrollIntoView = () => {};
});

let mounted: EditorInstance | null = null;
let target: HTMLElement | null = null;

afterEach(() => {
	if (mounted) void unmount(mounted);
	target?.remove();
	mounted = null;
	target = null;
	vi.useRealTimers();
});

function mountEditor(source: string) {
	target = document.createElement('div');
	document.body.appendChild(target);
	const props = $state({ source });
	mounted = mount(Editor, { target, props }) as EditorInstance;
	flushSync();
	const inputs: EditEvent[] = [];
	mounted.getEvents().on('edit', (e) => {
		if (e.op === 'input') inputs.push(e);
	});
	return { editor: mounted, props, inputs };
}

/** Real keystroke path: the block's own input listener, not a programmatic commit. */
function typeInFirstBlock(text: string): void {
	const el = target!.querySelector('.text-editable-block') as HTMLElement;
	el.textContent = text;
	el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

describe('the typing debounce is interrupted before the document it addresses goes away', () => {
	it('fires no input edit against the document that replaced the one typed in', async () => {
		const { props, inputs } = mountEditor('alpha\n\nbeta\n');
		vi.useFakeTimers();

		typeInFirstBlock('alpha!');
		await tick();
		expect(inputs).toHaveLength(0); // still batching

		props.source = 'gamma\n';
		flushSync();
		await tick();
		const flushedDuringSwap = inputs.length;

		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);

		// Whatever the swap chose to emit, the timer must contribute nothing after it.
		expect(inputs).toHaveLength(flushedDuringSwap);
		// And the keystroke is still accounted for — the batch is broken, not dropped.
		expect(flushedDuringSwap).toBe(1);
		expect(inputs[0].path).toEqual([0]);
	});

	// The flush emits `edit`, which the editor's own subscriber turns into a
	// deferred decoration run. At teardown that would schedule work a tick after
	// the component is gone, against a getter closed over its dead state.
	it('schedules no decoration work for the document it just tore down', async () => {
		const { editor, inputs } = mountEditor('alpha\n\nbeta\n');
		const provided: number[] = [];
		editor.getDecorations().addSource({
			name: 'probe',
			provide: (doc) => {
				provided.push(doc.children.length);
				return [];
			}
		});
		vi.useFakeTimers();

		typeInFirstBlock('alpha!');
		await tick();
		const providedBeforeTeardown = provided.length;
		expect(providedBeforeTeardown, 'the probe source never ran at all').toBeGreaterThan(0);

		void unmount(editor);
		mounted = null;
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
		const { editor, inputs } = mountEditor('alpha\n\nbeta\n');
		vi.useFakeTimers();

		typeInFirstBlock('alpha!');
		await tick();

		void unmount(editor);
		mounted = null;
		flushSync();
		const flushedDuringTeardown = inputs.length;

		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);

		expect(inputs).toHaveLength(flushedDuringTeardown);
		expect(flushedDuringTeardown).toBe(1);
	});
});
