// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import {
	installEditorBlurAnnouncer,
	installModActiveTracker,
	installSelectionChangeBridge,
	installViewportHeightWatcher
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

// ── Viewport-height watcher ──────────────────────────────────────────────────

describe('editor-root listeners — viewport-height watcher, window port', () => {
	it('bumps on a window resize, and stops after teardown', () => {
		let bumps = 0;
		const teardown = installViewportHeightWatcher(window, () => bumps++);
		teardowns.push(teardown);
		window.dispatchEvent(new Event('resize'));
		expect(bumps).toBe(1);
		teardown();
		window.dispatchEvent(new Event('resize'));
		expect(bumps).toBe(1);
	});
});

describe('editor-root listeners — viewport-height watcher, element port', () => {
	// Observable stand-in for the observer jsdom does not implement.
	class FakeResizeObserver {
		static instances: FakeResizeObserver[] = [];
		disconnected = false;
		constructor(private callback: ResizeObserverCallback) {
			FakeResizeObserver.instances.push(this);
		}
		observe(): void {}
		disconnect(): void {
			this.disconnected = true;
		}
		trigger(): void {
			this.callback([], this as unknown as ResizeObserver);
		}
	}

	beforeEach(() => {
		FakeResizeObserver.instances.length = 0;
		(globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
	});

	afterEach(() => {
		delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
	});

	function elementPort(initialHeight: number) {
		const el = document.createElement('div');
		let height = initialHeight;
		Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
		let bumps = 0;
		teardowns.push(installViewportHeightWatcher(el, () => bumps++));
		return {
			observer: FakeResizeObserver.instances[0],
			setHeight: (h: number) => (height = h),
			bumps: () => bumps
		};
	}

	it('bumps when the observed height changed', () => {
		const port = elementPort(100);
		port.setHeight(200);
		port.observer.trigger();
		expect(port.bumps()).toBe(1);
	});

	it('a report with the height unchanged (a width-only resize) does not bump', () => {
		const port = elementPort(100);
		port.observer.trigger();
		expect(port.bumps()).toBe(0);
	});

	it('teardown disconnects the observer', () => {
		const port = elementPort(100);
		teardowns.splice(0).forEach((teardown) => teardown());
		expect(port.observer.disconnected).toBe(true);
	});
});
