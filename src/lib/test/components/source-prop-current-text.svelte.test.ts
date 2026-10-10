// @vitest-environment jsdom
// A `source` write replaces the document only when it differs from the text the editor holds
// now, so a host that echoes `getSource()` back keeps its undo history, and a write back to an
// earlier text still reloads. Driven through a host component, since the rule sits in the effect.
// Miss-analysis: every swap test wrote a text the editor didn't hold, from a host that never echoed.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { installLayoutStubs, placeCaret } from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey, settleEditor } from '#lib/test/harness/settle.js';
import { UNDO_DEBOUNCE_MS } from '#lib/editor-actions/commit/text-batch.js';
import type { DocumentSwap } from '#lib/components/editor-root-document-swap.js';
import { serialize } from '#lib/core/serializer.js';
import SourceHost from './fixtures/SourceHost.svelte';

// Every `swapTo` call, and whether it replaced the document: the swap check itself has no
// public trace, and a mount-time swap fires before a host can subscribe.
const swapLog = vi.hoisted(() => ({ calls: [] as { source: string; swapped: boolean }[] }));
vi.mock('#lib/components/editor-root-document-swap.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('#lib/components/editor-root-document-swap.js')>();
	return {
		...actual,
		createDocumentSwap: (deps: Parameters<typeof actual.createDocumentSwap>[0]): DocumentSwap => {
			const swap = actual.createDocumentSwap(deps);
			return {
				...swap,
				swapTo(source) {
					const before = swap.generation();
					swap.swapTo(source);
					swapLog.calls.push({ source, swapped: swap.generation() !== before });
				}
			};
		}
	};
});

// Counted: an echoing host reads the text on every flushed keystroke, and each read may cost one.
vi.mock('#lib/core/serializer.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/core/serializer.js')>();
	return { ...actual, serialize: vi.fn(actual.serialize) };
});

beforeAll(installLayoutStubs);

const hosts: ReturnType<typeof mount>[] = [];
afterEach(async () => {
	vi.useRealTimers();
	for (const host of hosts.splice(0)) await unmount(host);
	document.body.innerHTML = '';
	swapLog.calls.length = 0;
});

function mountHost(text: string, echo = false) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const host = mount(SourceHost, { target, props: { text, echo } });
	hosts.push(host);
	flushSync();
	const editor = host.getEditor();
	const swaps: number[] = [];
	editor.getEvents().on('sourceSwap', (e) => swaps.push(e.generation));
	const surface = () => target.querySelector<HTMLElement>('.text-editable-block')!;
	return {
		editor,
		swaps,
		surface,
		async load(next: string) {
			host.load(next);
			await settleEditor();
		},
		/** One keystroke's worth of typing, flushed as its own undo step and `edit` event. */
		async type(blockText: string) {
			vi.useFakeTimers();
			surface().textContent = blockText;
			surface().dispatchEvent(new InputEvent('input', { bubbles: true }));
			await tick();
			vi.advanceTimersByTime(UNDO_DEBOUNCE_MS + 50);
			vi.useRealTimers();
			await settleEditor();
		}
	};
}

describe('a host that echoes getSource() back through source', () => {
	it('keeps the document and its undo history across three keystrokes', async () => {
		const host = mountHost('a\n', true);
		const block = host.surface();

		await host.type('ab');
		await host.type('abc');
		await host.type('abcd');

		expect(host.editor.getSource()).toBe('abcd\n');
		expect(host.swaps).toEqual([]);
		expect(host.surface()).toBe(block);

		placeCaret(host.surface(), 4);
		await pressKey(host.surface(), { key: 'z', ctrlKey: true });
		await settleEditor();
		expect(host.editor.getSource()).toBe('abc\n');
	});

	it('serializes the document once per flushed keystroke, dev check included', async () => {
		const host = mountHost('a\n', true);
		await host.type('ab');
		vi.mocked(serialize).mockClear();

		await host.type('abc');

		expect(vi.mocked(serialize).mock.calls).toHaveLength(1);
	});

	it('mounted empty, an echo of the placeholder line is no change, and a later empty write is', async () => {
		const host = mountHost('');
		await host.load('\n');
		expect(host.swaps).toEqual([]);

		await host.type('x');
		await host.load('');
		expect(host.swaps).toEqual([1]);
		expect(host.editor.getSource()).toBe('\n');
	});
});

// A history view, reduced: the host's note still holds the text it loaded, the author types, and
// the host then shows a version.
describe('showing a version through the source prop after typing', () => {
	it('control: a version unlike the loaded text is shown', async () => {
		const host = mountHost('loaded\n');
		await host.type('loadedtyped');

		await host.load('older\n');

		expect(host.swaps).toEqual([1]);
		expect(host.editor.getSource()).toBe('older\n');
	});

	it('a version equal to the loaded text is shown', async () => {
		const host = mountHost('loaded\n');
		await host.type('loadedtyped');

		await host.load('loaded\n');

		expect(host.swaps).toEqual([1]);
		expect(host.editor.getSource()).toBe('loaded\n');
	});
});

describe('mount', () => {
	it.each([
		['empty', ''],
		['CRLF', 'one\r\n\r\ntwo\r\n'],
		['no final line break', 'one\n\ntwo']
	])('a %s source fires no swap at mount', (_label, text) => {
		mountHost(text);
		expect(swapLog.calls).toEqual([]);
	});

	it('a write made before the first effect run still swaps', () => {
		const target = document.body.appendChild(document.createElement('div'));
		const host = mount(SourceHost, { target, props: { text: 'a\n' } });
		hosts.push(host);
		host.load('b\n');
		flushSync();
		expect(swapLog.calls).toEqual([{ source: 'b\n', swapped: true }]);
		expect(host.getEditor().getSource()).toBe('b\n');
	});
});

describe('the swap check subscribes to the source prop alone', () => {
	it('runs no check while the user types and the prop stays put', async () => {
		const host = mountHost('a\n');
		await host.load('b\n');
		expect(swapLog.calls).toEqual([{ source: 'b\n', swapped: true }]);

		await host.type('bx');
		await host.type('bxy');
		await host.type('bxyz');

		expect(swapLog.calls).toHaveLength(1);
		expect(host.editor.getSource()).toBe('bxyz\n');
	});
});
