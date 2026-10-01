// @vitest-environment jsdom
// A host that loads another document while the undo batch's pause is still running must hear the
// typed key's `edit` before the swap and nothing after it, or it writes the outgoing text back.
// Miss-analysis: the swap rows pinned the typing `edit` the swap released as correct, and no row
// had a host react to it.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { installLayoutStubs } from '$lib/test/harness/mount-editor.svelte';
import { settleEditor } from '$lib/test/harness/settle';
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
	return {
		host,
		editor,
		edits,
		/** One keystroke, with the pause timer held so it cannot end the batch on its own. */
		async type(blockText: string) {
			vi.useFakeTimers();
			const surface = target.querySelector<HTMLElement>('.text-editable-block')!;
			surface.textContent = blockText;
			surface.dispatchEvent(new InputEvent('input', { bubbles: true }));
			await tick();
		},
		/** Loads `next`, then lets the pause run out. */
		async loadThenPause(next: string) {
			host.load(next);
			flushSync();
			await tick();
			vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);
			vi.useRealTimers();
			await settleEditor();
		}
	};
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
});
