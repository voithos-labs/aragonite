// @vitest-environment jsdom
// A host that loads another document while the undo batch's pause is still running must hear the
// typed key's `edit` before the swap and nothing after it, or it writes the outgoing text back.
// Miss-analysis: the swap rows pinned the typing `edit` the swap released as correct, and no row
// had a host react to it.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { installLayoutStubs, placeCaret } from '$lib/test/harness/mount-editor.svelte';
import { dispatchKey, settleEditor } from '$lib/test/harness/settle';
import { UNDO_DEBOUNCE_MS } from '$lib/editor-actions/commit/text-batch';
import type { EditEvent } from '$lib/editor-events';
import SourceHost from './fixtures/SourceHost.svelte';

beforeAll(installLayoutStubs);

const hosts: ReturnType<typeof mount>[] = [];
afterEach(async () => {
	vi.useRealTimers();
	for (const host of hosts.splice(0)) await unmount(host);
	document.body.innerHTML = '';
});

function mountHost(text: string, echo = false) {
	const target = document.body.appendChild(document.createElement('div'));
	const host = mount(SourceHost, { target, props: { text, echo } });
	hosts.push(host);
	flushSync();
	const editor = host.getEditor();
	const edits: EditEvent[] = [];
	editor.getEvents().on('edit', (e) => edits.push(e));
	const surface = () => target.querySelector<HTMLElement>('.text-editable-block')!;
	return {
		host,
		editor,
		edits,
		surface,
		/** One keystroke, with the pause timer held so it cannot end the batch on its own. */
		async type(blockText: string) {
			vi.useFakeTimers();
			surface().textContent = blockText;
			surface().dispatchEvent(new InputEvent('input', { bubbles: true }));
			await tick();
		},
		/** Loads `next`, then lets the pause run out. */
		async loadThenPause(next: string) {
			host.load(next);
			flushSync();
			await tick();
			await pause();
		},
		pause
	};
}

async function pause() {
	vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);
	vi.useRealTimers();
	await settleEditor();
}

describe('a document swap inside the typing pause', () => {
	it('an echoing host ends on the document it loaded', async () => {
		const h = mountHost('a\n', true);

		await h.type('ab');
		const beforeSwap = h.edits.map((e) => e.op);
		await h.loadThenPause('other\n');

		expect(h.editor.getSource()).toBe('other\n');
		expect(beforeSwap).toEqual(['input']);
		expect(h.edits).toHaveLength(1);
	});

	it('a host saving each edit into its current note never saves one note into the other', async () => {
		const notes: Record<string, string> = { A: 'a\n', B: 'other\n' };
		let current = 'A';
		const h = mountHost(notes.A);
		h.editor.getEvents().on('edit', () => {
			notes[current] = h.editor.getSource();
		});

		await h.type('ab');
		current = 'B';
		await h.loadThenPause(notes.B);

		expect(notes).toEqual({ A: 'ab\n', B: 'other\n' });
	});

	it('an undo still placing its caret fires its edit before the host loads another document', async () => {
		const h = mountHost('a\n');
		await h.type('ab');
		await h.pause();
		placeCaret(h.surface(), 2);
		h.edits.length = 0;

		dispatchKey(h.surface(), { key: 'z', ctrlKey: true });
		// The swap goes in as soon as the undo has written, while its caret placement still waits.
		for (let i = 0; i < 50 && h.editor.getSource() === 'ab\n'; i++) await Promise.resolve();
		expect(h.editor.getSource()).toBe('a\n');
		const beforeSwap = h.edits.map((e) => e.op);
		h.host.load('other\n');
		flushSync();
		await settleEditor();

		expect(h.editor.getSource()).toBe('other\n');
		expect(beforeSwap).toEqual(['undo']);
		expect(h.edits.map((e) => e.op)).toEqual(['undo']);
	});
});
