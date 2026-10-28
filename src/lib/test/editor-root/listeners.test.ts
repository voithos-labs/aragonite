// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import {
	installEditorBlurAnnouncer,
	installModActiveTracker,
	installPressTracker,
	installRevealAnchorRelease,
	installSelectionChangeBridge
} from '#lib/components/editor-root/listeners.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';
import { createCaretWriter } from '#lib/browser/caret-writer.js';
import { createPressTracker } from '#lib/activation-click.js';
import { createCompositionTracker } from '#lib/browser/composition.js';

// Teardowns collect here so no test leaks a document-level listener into the next.
const teardowns: (() => void)[] = [];

beforeEach(() => {
	document.body.replaceChildren();
});

afterEach(() => {
	teardowns.splice(0).forEach((teardown) => teardown());
});

// ── Blur announcer ───────────────────────────────────────────────────────────

// Miss-analysis: no selectionChange test moved focus out of the editor.
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
	function bridge(widgetSelected = false) {
		const root = document.createElement('div');
		const header = document.createElement('div');
		const headerField = document.createElement('span');
		headerField.textContent = 'title';
		header.append(headerField);
		const content = document.createElement('p');
		content.setAttribute('data-block-path', '[0]');
		content.textContent = 'body text';
		// The image popover mounts inside the root but outside every block.
		const popover = document.createElement('div');
		const popoverField = document.createElement('input');
		popover.append(popoverField);
		root.append(header, content, popover);
		const outside = document.createElement('p');
		outside.textContent = 'elsewhere';
		document.body.append(root, outside);

		let emits = 0;
		const teardown = installSelectionChangeBridge({
			caretWriter: testCaretWriter,
			composition: { live: () => false },
			root,
			isHostChrome: (node) => !!node && header.contains(node),
			announceIfMoved: () => emits++,
			selection: {
				widget: widgetSelected ? { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 } : null
			}
		});
		teardowns.push(teardown);
		return { headerField, content, popover, outside, teardown, emits: () => emits };
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

	function caretInside(el: Node): void {
		window.getSelection()?.collapse(el.firstChild, 0);
	}

	// Miss-analysis: the image-selection specs read the selected text, which a caret leaves empty.
	it('drops, and never announces, a caret the browser puts beside a selected widget', () => {
		const b = bridge(true);
		caretInside(b.content);
		fire();
		expect(window.getSelection()?.rangeCount).toBe(0);
		expect(b.emits()).toBe(0);
	});

	it('keeps a range dragged while a widget is selected', () => {
		const b = bridge(true);
		selectInside(b.content);
		fire();
		expect(window.getSelection()?.rangeCount).toBe(1);
		expect(b.emits()).toBe(1);
	});

	// Miss-analysis: the popover spec read only the source, which a reset cursor rarely breaks.
	it('keeps a caret in a popover field while a widget is selected', () => {
		const b = bridge(true);
		window.getSelection()?.collapse(b.popover, 0);
		fire();
		expect(window.getSelection()?.rangeCount).toBe(1);
	});

	it('keeps a caret when no widget is selected', () => {
		const b = bridge();
		caretInside(b.content);
		fire();
		expect(window.getSelection()?.rangeCount).toBe(1);
	});

	// Miss-analysis: every bridge row put the caret where Chromium does; Firefox leaves one inside a
	// widget, where no key types.
	describe('a caret the browser left inside a widget', () => {
		function surfaceBridge() {
			const root = document.createElement('div');
			const surface = document.createElement('div');
			surface.setAttribute('contenteditable', 'true');
			surface.innerHTML =
				'Text <span data-inline-widget="" data-source-start="5" data-source-end="10" contenteditable="false">x<sup>2</sup></span>';
			root.append(surface);
			document.body.append(root);
			surface.focus();
			let emits = 0;
			const composition = createCompositionTracker();
			teardowns.push(composition.install(root));
			teardowns.push(
				installSelectionChangeBridge({
					caretWriter: createCaretWriter(
						() => {},
						() => false
					),
					composition,
					root,
					isHostChrome: () => false,
					announceIfMoved: () => emits++,
					selection: { widget: null }
				})
			);
			window.getSelection()!.collapse(surface.querySelector('sup')!.firstChild, 1);
			return { root, surface, emits: () => emits };
		}

		it('moves to the widget’s edge, then announces', () => {
			const b = surfaceBridge();
			fire();
			const sel = window.getSelection()!;
			expect({ node: sel.focusNode, offset: sel.focusOffset }).toEqual({
				node: b.surface,
				offset: 2
			});
			expect(b.emits()).toBe(1);
		});

		it('stays put during a composition', () => {
			const b = surfaceBridge();
			b.surface.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
			fire();
			expect(window.getSelection()!.focusNode?.textContent).toBe('2');
		});

		// Miss-analysis: the bridge kept its own flag and cleared it on any key saying it wasn't
		// composing, and no row sent the key an IME feeds with code 229 and `isComposing: false`.
		it('stays put through a key the IME feeds with isComposing false', () => {
			const b = surfaceBridge();
			b.surface.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
			const feed = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
			Object.defineProperty(feed, 'keyCode', { value: 229 });
			b.surface.dispatchEvent(feed);
			fire();
			expect(window.getSelection()!.focusNode?.textContent).toBe('2');
		});

		it('moves again once a plain key shows a dropped composition ended', () => {
			const b = surfaceBridge();
			b.surface.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
			b.surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
			fire();
			expect(window.getSelection()!.focusNode).toBe(b.surface);
		});
	});

	// Miss-analysis: every row focused the block; the editor root takes focus when a block
	// unmounts or a press lands on chrome, and the walk then counted every block as one.
	it('stays put while the editor root, not a block, holds focus', () => {
		const root = document.createElement('div');
		root.setAttribute('data-presentation', 'live');
		root.tabIndex = -1;
		root.innerHTML = '<div contenteditable="true">one</div><div contenteditable="true">two</div>';
		document.body.append(root);
		root.focus();
		teardowns.push(
			installSelectionChangeBridge({
				caretWriter: createCaretWriter(
					() => {},
					() => false
				),
				composition: { live: () => false },
				root,
				isHostChrome: () => false,
				announceIfMoved: () => {},
				selection: { widget: null }
			})
		);
		const two = root.lastElementChild!.firstChild!;
		window.getSelection()!.collapse(two, 0);
		fire();
		const sel = window.getSelection()!;
		expect([sel.focusNode?.textContent, sel.focusOffset]).toEqual(['two', 0]);
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

// ── Press tracker ────────────────────────────────────────────────────────────

describe('editor-root listeners: press tracker', () => {
	it('records a press a child stops, so a release there can still tell it travelled', () => {
		const root = document.createElement('div');
		const child = document.createElement('span');
		child.addEventListener('pointerdown', (e) => e.stopPropagation());
		root.append(child);
		document.body.append(root);
		const presses = createPressTracker();
		teardowns.push(installPressTracker(root, presses));

		child.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));

		expect(presses.travelled({ clientX: 40, clientY: 10 })).toBe(true);
		expect(presses.travelled({ clientX: 11, clientY: 10 })).toBe(false);
	});
});
