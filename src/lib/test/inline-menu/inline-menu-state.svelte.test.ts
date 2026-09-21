import { describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { parse } from '$lib/core/parser';
import type { DocumentView } from '$lib/core/node-views';
import { createEditorEvents, type EditEvent } from '$lib/editor-events';
import { createInlineMenuState } from '$lib/inline-menu/inline-menu-state.svelte';
import type { InlineMenuItem, InlineMenuSource } from '$lib/inline-menu/types';
import type { PresentationMode } from '$lib/presentation-mode';

const item = (id: string, insert = id): InlineMenuItem => ({ id, label: id, insert });

const typedEdit = (path: number[]): EditEvent =>
	({ op: 'input', path, detail: { byteLength: 1 }, timestamp: 0 }) as EditEvent;

/** One paragraph whose bytes and caret the test moves by hand, the way a keystroke would. */
function harness(initial: string, { arrive = true } = {}) {
	let doc = parse(initial) as unknown as DocumentView;
	let caret: number | null = initial.length;
	let mode: PresentationMode = 'source';
	const events = createEditorEvents();
	const errors: unknown[] = [];
	events.on('error', (e) => errors.push(e.error));
	const landed: number[] = [];

	const menu = createInlineMenuState({
		getDoc: () => doc,
		getSelection: () =>
			caret === null
				? null
				: { anchor: { path: [0], offset: caret }, focus: { path: [0], offset: caret } },
		getMode: () => mode,
		events,
		commitRange: async (_path, start, end, bytes) => {
			const raw = doc.children[0].raw;
			doc = parse(raw.slice(0, start) + bytes + raw.slice(end)) as unknown as DocumentView;
		},
		landCaret: async (_path, offset) => {
			caret = offset;
			landed.push(offset);
			return true;
		}
	});

	// The caret arriving in the block is the editor's first news of it, as a click's would be.
	if (arrive) events.emit('selectionChange', null);

	return {
		menu,
		errors,
		landed,
		raw: () => doc.children[0].raw,
		setMode: (next: PresentationMode) => (mode = next),
		/** Type at the caret, one keystroke per character: the byte lands, then its `edit`. */
		async type(text: string) {
			await tick();
			for (const ch of text) {
				const raw = doc.children[0]?.raw ?? '';
				const at = caret ?? raw.length;
				doc = parse(raw.slice(0, at) + ch + raw.slice(at)) as unknown as DocumentView;
				caret = at + 1;
				events.emit('edit', typedEdit([0]));
				await tick();
			}
		},
		/** A burst the editor publishes as ONE change: fast typing, an IME commit. */
		async burst(text: string) {
			await tick();
			const raw = doc.children[0]?.raw ?? '';
			const at = caret ?? raw.length;
			doc = parse(raw.slice(0, at) + text + raw.slice(at)) as unknown as DocumentView;
			caret = at + text.length;
			events.emit('edit', typedEdit([0]));
			await tick();
		},
		/** The bytes land a read BEFORE the caret that typed them catches up. */
		async typeWithLateCaret(text: string) {
			await tick();
			const raw = doc.children[0].raw;
			const at = caret ?? raw.length;
			doc = parse(raw.slice(0, at) + text + raw.slice(at)) as unknown as DocumentView;
			events.emit('edit', typedEdit([0]));
			await tick();
			caret = at + text.length;
			events.emit('selectionChange', null);
			await tick();
		},
		/** Bytes changing under a caret that does not follow them: an undo, a remote rewrite. */
		async rewrite(raw: string) {
			await tick();
			doc = parse(raw) as unknown as DocumentView;
			events.emit('edit', typedEdit([0]));
			await tick();
		},
		/** Move the caret with no edit: an arrow key, a click. */
		async moveTo(offset: number | null) {
			caret = offset;
			events.emit('selectionChange', null);
			await tick();
		}
	};
}

const tags = (over: Partial<InlineMenuSource> = {}): InlineMenuSource => ({
	name: 'tags',
	trigger: '#',
	opensAt: (raw, pos) => pos === 0 || /\s/.test(raw[pos - 1]),
	accepts: (query) => /^\w*$/.test(query),
	items: ({ query }) =>
		['work', 'world', 'home'].filter((t) => t.startsWith(query)).map((t) => item(t, `#${t}`)),
	...over
});

describe('a typed trigger opens its source', () => {
	it('opens on the trigger and narrows as the query grows', async () => {
		const h = harness('see ');
		h.menu.registry.addSource(tags());

		await h.type('#');
		expect(h.menu.getOpen()).toMatchObject({ start: 4, end: 5, query: '' });
		expect(h.menu.getOpen()!.items.map((i) => i.id)).toEqual(['work', 'world', 'home']);
		expect(h.menu.registry.isOpen).toBe(true);

		await h.type('wo');
		expect(h.menu.getOpen()).toMatchObject({ start: 4, end: 7, query: 'wo' });
		expect(h.menu.getOpen()!.items.map((i) => i.id)).toEqual(['work', 'world']);
	});

	it('opens on a burst that carries the query in with the trigger', async () => {
		const h = harness('see ');
		h.menu.registry.addSource(tags());
		await h.burst('#wo');
		expect(h.menu.getOpen()).toMatchObject({ start: 4, end: 7, query: 'wo' });
		expect(h.menu.getOpen()!.items.map((i) => i.id)).toEqual(['work', 'world']);
	});

	it('opens when the caret catches up with its bytes a read late', async () => {
		const h = harness('see ');
		h.menu.registry.addSource(tags());
		await h.typeWithLateCaret('#');
		expect(h.menu.getOpen()).toMatchObject({ start: 4, end: 5, query: '' });
	});

	it('adopts a change no caret explains, so later typing still opens', async () => {
		const h = harness('see ');
		h.menu.registry.addSource(tags());
		await h.rewrite('well, see ');
		// Held back once, adopted on the next read, whatever prompts it.
		await h.moveTo(10);
		await h.type('#');
		expect(h.menu.getOpen()).toMatchObject({ start: 10 });
	});

	it('opens on the first keystroke in a leaf no read had seen, given the keydown baseline', async () => {
		// No arrival read: the state has never looked at this leaf.
		const h = harness('see ', { arrive: false });
		h.menu.registry.addSource(tags());
		h.menu.primeBaseline();
		await h.burst('#');
		expect(h.menu.getOpen()).toMatchObject({ start: 4, query: '' });

		const unprimed = harness('see ', { arrive: false });
		unprimed.menu.registry.addSource(tags());
		await unprimed.burst('#');
		expect(unprimed.menu.getOpen()).toBeNull();
	});

	it('never advances a standing baseline at keydown, which a burst depends on', async () => {
		const h = harness('see ');
		h.menu.registry.addSource(tags());
		await h.moveTo(4);
		// keydown `#`, its byte, keydown `w`, its byte: two presses, one published change.
		h.menu.primeBaseline();
		h.menu.primeBaseline();
		await h.burst('#w');
		expect(h.menu.getOpen()).toMatchObject({ start: 4, query: 'w' });
	});

	it('does not open for a caret that merely arrives beside an existing trigger', async () => {
		const h = harness('see #');
		h.menu.registry.addSource(tags());
		await h.moveTo(5);
		expect(h.menu.getOpen()).toBeNull();
	});

	it('does not open where the source declines the position', async () => {
		const h = harness('C');
		h.menu.registry.addSource(tags());
		await h.type('#');
		expect(h.menu.getOpen()).toBeNull();
	});

	it('does not open inside inline code, where the trigger is not syntax', async () => {
		const h = harness('`a b`');
		h.menu.registry.addSource(tags());
		await h.moveTo(3);
		await h.type('#');
		expect(h.raw()).toBe('`a #b`');
		expect(h.menu.getOpen()).toBeNull();
	});

	it('does not open in reading mode', async () => {
		const h = harness('a ');
		h.menu.registry.addSource(tags());
		h.setMode('reading');
		await h.type('#');
		expect(h.menu.getOpen()).toBeNull();
	});
});

describe('an open session follows the caret', () => {
	it('closes on a query the source does not accept, and leaves the bytes', async () => {
		const h = harness('a ');
		h.menu.registry.addSource(tags());
		await h.type('#wo');
		expect(h.menu.getOpen()).not.toBeNull();
		await h.type(' ');
		expect(h.menu.getOpen()).toBeNull();
		expect(h.raw()).toBe('a #wo ');
	});

	it('closes when the caret leaves the query, and when the selection is lost', async () => {
		const h = harness('ab ');
		h.menu.registry.addSource(tags());
		await h.type('#wo');
		expect(h.menu.getOpen()).not.toBeNull();
		await h.moveTo(1);
		expect(h.menu.getOpen()).toBeNull();

		await h.moveTo(6);
		await h.type('r');
		// Dismissed for this trigger: more typing after it reopens nothing.
		expect(h.menu.getOpen()).toBeNull();
	});

	it('holds no keys over an empty list, while the session stays alive', async () => {
		const h = harness('a ');
		h.menu.registry.addSource(tags());
		await h.type('#z');
		expect(h.menu.getOpen()).toMatchObject({ query: 'z', items: [] });
		expect(h.menu.registry.isOpen).toBe(false);
		expect(h.menu.commit()).toBe(false);
	});

	it('closes when its source is disposed', async () => {
		const h = harness('a ');
		const handle = h.menu.registry.addSource(tags());
		await h.type('#');
		handle.dispose();
		expect(h.menu.getOpen()).toBeNull();
	});
});

describe('navigation and commit', () => {
	it('steps the active row with wrap, and resets it when the query moves', async () => {
		const h = harness('a ');
		h.menu.registry.addSource(tags());
		await h.type('#');
		h.menu.move(-1);
		expect(h.menu.getOpen()!.activeIndex).toBe(2);
		h.menu.move(1);
		expect(h.menu.getOpen()!.activeIndex).toBe(0);
		h.menu.move(1);
		await h.type('w');
		expect(h.menu.getOpen()!.activeIndex).toBe(0);
	});

	it('replaces the trigger and the query with the pick, and lands the caret after it', async () => {
		const onCommit = vi.fn();
		const h = harness('see ');
		h.menu.registry.addSource(tags({ onCommit }));
		await h.type('#wo');
		h.menu.move(1);

		expect(h.menu.commit()).toBe(true);
		await vi.waitFor(() => expect(onCommit).toHaveBeenCalled());

		expect(h.raw()).toBe('see #world');
		expect(h.landed).toEqual([10]);
		expect(h.menu.getOpen()).toBeNull();
		expect(onCommit.mock.calls[0][0]).toMatchObject({ id: 'world' });
		expect(onCommit.mock.calls[0][1]).toEqual({ query: 'wo', path: [0], start: 4, end: 7 });
	});

	it('does not reopen on its own write, even where the pick ends in a trigger', async () => {
		const h = harness('a ');
		h.menu.registry.addSource(tags({ items: () => [item('odd', '#odd #')] }));
		await h.type('#');
		h.menu.commit();
		await vi.waitFor(() => expect(h.raw()).toBe('a #odd #'));
		await tick();
		expect(h.menu.getOpen()).toBeNull();
	});
});

describe('asynchronous sources', () => {
	it('drops a slow answer a later keystroke superseded, and aborts its signal', async () => {
		const pending: {
			query: string;
			resolve: (items: InlineMenuItem[]) => void;
			signal: AbortSignal;
		}[] = [];
		const h = harness('a ');
		h.menu.registry.addSource(
			tags({
				items: ({ query, signal }) =>
					new Promise((resolve) => pending.push({ query, resolve, signal }))
			})
		);
		await h.type('#');
		await h.type('w');
		expect(pending.map((p) => p.query)).toEqual(['', 'w']);
		expect(pending[0].signal.aborted).toBe(true);

		pending[1].resolve([item('work')]);
		await tick();
		pending[0].resolve([item('stale')]);
		await tick();
		expect(h.menu.getOpen()!.items.map((i) => i.id)).toEqual(['work']);
	});

	it('reads a rejected list as empty and reports it', async () => {
		const h = harness('a ');
		h.menu.registry.addSource(tags({ items: () => Promise.reject(new Error('index offline')) }));
		await h.type('#');
		await vi.waitFor(() => expect(h.errors).toHaveLength(1));
		expect(h.menu.getOpen()).toMatchObject({ items: [] });
	});

	it('reports a source that throws', async () => {
		const h = harness('a ');
		h.menu.registry.addSource(
			tags({
				items: () => {
					throw new Error('boom');
				}
			})
		);
		await h.type('#');
		expect(h.errors).toHaveLength(1);
	});
});

describe('open(name): the shortcut and button door', () => {
	it('types the trigger at the caret and opens there, position rule or not', async () => {
		const h = harness('mid');
		h.menu.registry.addSource(tags());
		expect(h.menu.registry.open('tags')).toBe(true);
		await vi.waitFor(() => expect(h.menu.getOpen()).not.toBeNull());
		expect(h.raw()).toBe('mid#');
		expect(h.menu.getOpen()).toMatchObject({ start: 3, end: 4, query: '' });
	});

	it('declines an unknown name, reading mode, and a lost caret, writing nothing', async () => {
		const h = harness('x');
		h.menu.registry.addSource(tags());
		expect(h.menu.registry.open('nope')).toBe(false);
		h.setMode('reading');
		expect(h.menu.registry.open('tags')).toBe(false);
		h.setMode('source');
		await h.moveTo(null);
		expect(h.menu.registry.open('tags')).toBe(false);
		expect(h.raw()).toBe('x');
	});
});

describe('the registry', () => {
	it('refuses a second source under one name', () => {
		const h = harness('a ');
		h.menu.registry.addSource(tags());
		expect(() => h.menu.registry.addSource(tags())).toThrow(/already exists/);
	});
});
