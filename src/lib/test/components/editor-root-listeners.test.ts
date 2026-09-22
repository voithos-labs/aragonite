// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import {
	installEditorBlurAnnouncer,
	installModActiveTracker,
	installRevealAnchorRelease,
	installSelectionChangeBridge
} from '$lib/components/editor-root-listeners';

// Teardowns collect here so no test leaks a document-level listener into the next.
const teardowns: (() => void)[] = [];

beforeEach(() => {
	document.body.replaceChildren();
});

afterEach(() => {
	teardowns.splice(0).forEach((teardown) => teardown());
});

// ── Blur announcer ───────────────────────────────────────────────────────────

// Miss-analysis: every selectionChange emitter fired on selections the editor still held, so no
// test ever moved focus out of the editor and asked whether subscribers heard about it.
describe('editor-root listeners: blur announcer', () => {
	function announcer() {
		const root = document.createElement('div');
		const inside = document.createElement('button');
		root.append(inside);
		const outside = document.createElement('button');
		document.body.append(root, outside);
		let emitted = 0;
		teardowns.push(installEditorBlurAnnouncer({ root, announce: () => emitted++ }));
		return { root, inside, outside, count: () => emitted };
	}

	it('emits when focus departs the root for an outside target', async () => {
		const t = announcer();
		t.outside.focus();
		t.root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: t.outside }));
		await tick();
		expect(t.count()).toBe(1);
	});

	it('emits when focus departs for no target at all', async () => {
		const t = announcer();
		t.root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
		await tick();
		expect(t.count()).toBe(1);
	});

	it('stays silent when focus moves within the root', async () => {
		const t = announcer();
		t.root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: t.inside }));
		await tick();
		expect(t.count()).toBe(0);
	});

	// A structural commit unmounts the focused block (focusout, no relatedTarget) and puts
	// focus back after its own tick: focus that came back never left.
	it('stays silent when focus returns to the root within the flush', async () => {
		const t = announcer();
		t.root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
		t.inside.focus();
		await tick();
		expect(t.count()).toBe(0);
	});
});

// ── Mod-active tracker ───────────────────────────────────────────────────────

describe('editor-root listeners: mod-active tracker', () => {
	function tracker() {
		const root = document.createElement('div');
		document.body.append(root);
		const teardown = installModActiveTracker(root);
		teardowns.push(teardown);
		return { root, teardown, isActive: () => root.hasAttribute('data-mod-active') };
	}

	it.each<[string, KeyboardEventInit]>([
		['Ctrl', { ctrlKey: true }],
		['Meta', { metaKey: true }]
	])('%s keydown marks the root; a bare keyup clears it', (_label, init) => {
		const t = tracker();
		document.dispatchEvent(new KeyboardEvent('keydown', init));
		expect(t.isActive()).toBe(true);
		document.dispatchEvent(new KeyboardEvent('keyup', {}));
		expect(t.isActive()).toBe(false);
	});

	it('window blur clears a held modifier', () => {
		const t = tracker();
		document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true }));
		window.dispatchEvent(new Event('blur'));
		expect(t.isActive()).toBe(false);
	});

	it('visibility loss clears a held modifier', () => {
		const t = tracker();
		document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true }));
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden'
		});
		try {
			document.dispatchEvent(new Event('visibilitychange'));
		} finally {
			delete (document as { visibilityState?: unknown }).visibilityState;
		}
		expect(t.isActive()).toBe(false);
	});

	it('teardown detaches the listeners', () => {
		const t = tracker();
		t.teardown();
		document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true }));
		expect(t.isActive()).toBe(false);
	});
});

// ── Selectionchange bridge ───────────────────────────────────────────────────

describe('editor-root listeners: selectionchange bridge', () => {
	function bridge() {
		const root = document.createElement('div');
		const header = document.createElement('div');
		const headerField = document.createElement('span');
		headerField.textContent = 'title';
		header.append(headerField);
		const content = document.createElement('p');
		content.textContent = 'body text';
		root.append(header, content);
		const outside = document.createElement('p');
		outside.textContent = 'elsewhere';
		document.body.append(root, outside);

		let emits = 0;
		const teardown = installSelectionChangeBridge({
			root,
			isHostChrome: (node) => !!node && header.contains(node),
			announceIfMoved: () => emits++
		});
		teardowns.push(teardown);
		return { headerField, content, outside, teardown, emits: () => emits };
	}

	function selectInside(el: Node): void {
		const range = document.createRange();
		range.selectNodeContents(el);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	const fire = () => document.dispatchEvent(new Event('selectionchange'));
	const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

	it('emits for a selection in the editor content', () => {
		const b = bridge();
		selectInside(b.content);
		fire();
		expect(b.emits()).toBe(1);
	});

	it('stays silent for a host-chrome selection', () => {
		const b = bridge();
		selectInside(b.headerField);
		fire();
		expect(b.emits()).toBe(0);
	});

	it('stays silent for a selection outside the root', () => {
		const b = bridge();
		selectInside(b.outside);
		fire();
		expect(b.emits()).toBe(0);
	});

	it('stays silent with no range at all', () => {
		const b = bridge();
		window.getSelection()?.removeAllRanges();
		fire();
		expect(b.emits()).toBe(0);
	});

	// The browser reports a click's caret a task later, so the click itself announces too.
	it('emits for a click in the editor content', () => {
		const b = bridge();
		selectInside(b.content);
		click(b.content);
		expect(b.emits()).toBe(1);
	});

	it('stays silent for a click in the host chrome', () => {
		const b = bridge();
		selectInside(b.headerField);
		click(b.headerField);
		expect(b.emits()).toBe(0);
	});

	it('teardown detaches both listeners', () => {
		const b = bridge();
		b.teardown();
		selectInside(b.content);
		fire();
		click(b.content);
		expect(b.emits()).toBe(0);
	});
});

// ── Releasing the held block ─────────────────────────────────────────────────

describe('editor-root listeners: reveal-anchor release', () => {
	function release() {
		const port = document.createElement('div');
		document.body.append(port);
		let released = 0;
		teardowns.push(installRevealAnchorRelease(port, () => released++));
		return { port, count: () => released };
	}

	it.each(['keydown', 'pointerdown', 'wheel'])('%s on the port releases the pin', (type) => {
		const r = release();
		r.port.dispatchEvent(new Event(type));
		expect(r.count()).toBe(1);
	});

	// A programmatic scroll correction fires `scroll` itself and would release the hold
	// half way through.
	it('a scroll releases nothing', () => {
		const r = release();
		r.port.dispatchEvent(new Event('scroll'));
		expect(r.count()).toBe(0);
	});
});
