// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import {
	installDoubleClickWordSelect,
	installEditorBlurAnnouncer,
	installModActiveTracker,
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
// test ever took focus OUT of the editor and asked whether the channel reported the departure.
describe('editor-root listeners — blur announcer', () => {
	function announcer() {
		const root = document.createElement('div');
		const inside = document.createElement('button');
		root.append(inside);
		const outside = document.createElement('button');
		document.body.append(root, outside);
		let emitted = 0;
		teardowns.push(installEditorBlurAnnouncer({ root, emit: () => emitted++ }));
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

	// A structural commit unmounts the focused surface (focusout, no relatedTarget) and lands
	// focus again after its own tick: a departure that came back is no departure at all.
	it('stays silent when focus returns to the root within the flush', async () => {
		const t = announcer();
		t.root.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
		t.inside.focus();
		await tick();
		expect(t.count()).toBe(0);
	});
});

// ── Mod-active tracker ───────────────────────────────────────────────────────

describe('editor-root listeners — mod-active tracker', () => {
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

describe('editor-root listeners — selectionchange bridge', () => {
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
			emit: () => emits++
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

	it('teardown detaches the listener', () => {
		const b = bridge();
		b.teardown();
		selectInside(b.content);
		fire();
		expect(b.emits()).toBe(0);
	});
});

// ── Double-click word select ─────────────────────────────────────────────────

// Miss-analysis: the second-press listener lived inline in Editor.svelte with no test at its own
// level, so the one press it must decline — one on an inline widget that owns its double-click —
// was only ever caught by a footnote spec two layers up.
describe('editor-root listeners — double-click word select', () => {
	function mounted() {
		const root = document.createElement('div');
		const editable = document.createElement('p');
		editable.setAttribute('contenteditable', 'true');
		editable.textContent = 'hello world';
		const widget = document.createElement('span');
		widget.setAttribute('data-inline-widget', '');
		widget.textContent = '[^a]';
		editable.append(widget);
		// jsdom leaves isContentEditable unimplemented; the fixture answers for the browser.
		for (const el of [editable, widget]) {
			Object.defineProperty(el, 'isContentEditable', { value: true });
		}
		root.append(editable);
		document.body.append(root);
		teardowns.push(installDoubleClickWordSelect(root));
		return { root, editable, widget };
	}

	function secondPress(target: Element, init: MouseEventInit = {}): MouseEvent {
		const event = new MouseEvent('mousedown', {
			detail: 2,
			button: 0,
			bubbles: true,
			cancelable: true,
			...init
		});
		target.dispatchEvent(event);
		return event;
	}

	it('leaves a second press on an inline widget to the widget', () => {
		const t = mounted();
		expect(secondPress(t.widget).defaultPrevented).toBe(false);
	});

	it('leaves a modified second press to the browser', () => {
		const t = mounted();
		expect(secondPress(t.editable, { ctrlKey: true }).defaultPrevented).toBe(false);
		expect(secondPress(t.editable, { shiftKey: true }).defaultPrevented).toBe(false);
	});

	it('leaves a press outside an editable surface alone', () => {
		const t = mounted();
		expect(secondPress(t.root).defaultPrevented).toBe(false);
	});

	it("the dblclick trims the trailing space off the browser's own word selection", () => {
		const t = mounted();
		const text = t.editable.firstChild as Text;
		document.getSelection()!.setBaseAndExtent(text, 0, text, 6);
		t.editable.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		expect(document.getSelection()!.toString()).toBe('hello');
	});
});
