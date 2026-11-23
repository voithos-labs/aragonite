// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createFocusAttribution } from '#lib/components/editor-root/focus.js';
import type { PresentationMode } from '#lib/presentation-mode.js';

const teardowns: (() => void)[] = [];

afterEach(() => {
	teardowns.splice(0).forEach((teardown) => teardown());
	document.body.replaceChildren();
});

// Miss-analysis: focus path and attribute were tested only through a mounted editor in one mode.
function editor(mode: PresentationMode = 'source') {
	const root = document.createElement('div');
	const host = (path: number[]) => {
		const el = document.createElement('div');
		el.setAttribute('data-block-path', JSON.stringify(path));
		const leaf = document.createElement('button');
		el.append(leaf);
		root.append(el);
		return { el, leaf };
	};
	const first = host([0]);
	const second = host([1]);
	const outside = document.createElement('button');
	document.body.append(root, outside);
	let current = mode;
	const moved: Element[] = [];
	const attribution = createFocusAttribution({
		get mode() {
			return current;
		},
		textMoves: { movedWithin: (el) => moved.push(el) }
	});
	const teardown = attribution.install(root);
	teardowns.push(teardown);
	const focusIn = (target: Element) =>
		target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
	const focusOut = (target: Element, relatedTarget: Element | null) =>
		target.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget }));
	const marked = () => [...root.querySelectorAll('[data-focused]')];
	return {
		root,
		first,
		second,
		outside,
		attribution,
		teardown,
		focusIn,
		focusOut,
		marked,
		moved,
		setMode: (next: PresentationMode) => (current = next)
	};
}

describe('editor-root focus attribution: the per-level pin', () => {
	it('focus inside a host pins its path; focus on no host clears it', () => {
		const e = editor();
		e.focusIn(e.second.leaf);
		expect(e.attribution.getFocusedPath()).toEqual([1]);
		e.focusIn(e.root);
		expect(e.attribution.getFocusedPath()).toBeNull();
	});

	it('focusout toward a node still in the root keeps the pin; departing clears it', () => {
		const e = editor();
		e.focusIn(e.first.leaf);
		e.focusOut(e.first.leaf, e.second.leaf);
		expect(e.attribution.getFocusedPath()).toEqual([0]);
		e.focusOut(e.first.leaf, e.outside);
		expect(e.attribution.getFocusedPath()).toBeNull();
		e.focusIn(e.first.leaf);
		e.focusOut(e.first.leaf, null);
		expect(e.attribution.getFocusedPath()).toBeNull();
	});

	// Miss-analysis: every case focused a host and read at once, so none saw a keyed move renumber
	// the focused host while focus stayed on it, which left the path naming its old sibling.
	it('names the focused block where it is now, after a move that keeps focus', () => {
		const e = editor();
		e.focusIn(e.second.leaf);
		e.root.insertBefore(e.second.el, e.first.el);
		e.second.el.setAttribute('data-block-path', '[0]');
		e.first.el.setAttribute('data-block-path', '[1]');
		expect(e.attribution.getFocusedPath()).toEqual([0]);
		e.second.el.remove();
		expect(e.attribution.getFocusedPath()).toBeNull();
	});

	it('teardown detaches the listeners', () => {
		const e = editor();
		e.teardown();
		e.focusIn(e.first.leaf);
		expect(e.attribution.getFocusedPath()).toBeNull();
	});
});

describe('editor-root focus attribution: data-focused', () => {
	it('marks the focused host under a preview mode only, and re-applies on a mode change', () => {
		const e = editor('source');
		e.focusIn(e.first.leaf);
		expect(e.marked()).toEqual([]);
		e.setMode('preview-block');
		e.attribution.applyForMode();
		expect(e.marked()).toEqual([e.first.el]);
		e.setMode('reading');
		e.attribution.applyForMode();
		expect(e.marked()).toEqual([]);
	});

	// Miss-analysis: every mark test read the attribute, never that the text it moves was reported.
	it('reports the text moving in both hosts whenever the mark moves, and only then', () => {
		const e = editor('preview-block');
		e.focusIn(e.first.leaf);
		expect(e.moved).toEqual([e.first.el]);
		e.focusIn(e.first.leaf);
		e.focusIn(e.second.leaf);
		expect(e.moved).toEqual([e.first.el, e.first.el, e.second.el]);
		e.setMode('source');
		e.attribution.applyForMode();
		expect(e.moved.slice(3)).toEqual([e.second.el]);
		e.focusIn(e.first.leaf);
		expect(e.moved).toHaveLength(4);
	});

	// Miss-analysis: only the preview modes' attribute was reported, never a block of bare markers.
	it('reports a block holding only markers each time focus enters or leaves it, in any mode', () => {
		const e = editor('live');
		e.first.leaf.setAttribute('data-content-empty', '');
		e.focusIn(e.second.leaf);
		expect(e.moved).toEqual([]);
		e.focusIn(e.first.leaf);
		e.focusIn(e.second.leaf);
		expect(e.moved).toEqual([e.first.el, e.first.el]);
	});

	it('moving focus between hosts moves the mark; leaving the root drops it', () => {
		const e = editor('preview-inline');
		e.focusIn(e.first.leaf);
		e.focusIn(e.second.leaf);
		expect(e.marked()).toEqual([e.second.el]);
		e.focusOut(e.second.leaf, e.outside);
		expect(e.marked()).toEqual([]);
	});

	// Miss-analysis: every mark test moved focus with no button down, never mid-press.
	it.each(['pointerup', 'pointercancel'])(
		'a held press keeps the mark where it was until %s',
		(release) => {
			const e = editor('preview-block');
			e.focusIn(e.first.leaf);
			const press = (type: string, target: Element) =>
				target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
			press('pointerdown', e.second.leaf);
			e.focusIn(e.second.leaf);
			expect(e.marked()).toEqual([e.first.el]);
			expect(e.attribution.getFocusedPath()).toEqual([1]);
			press(release, e.second.leaf);
			expect(e.marked()).toEqual([e.second.el]);
		}
	);

	// Miss-analysis: every held-press row ended in a release that reached the page.
	it('focus leaves mid-press with no release: the mark goes with it', () => {
		const e = editor('preview-block');
		e.focusIn(e.first.leaf);
		e.second.leaf.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
		e.focusIn(e.second.leaf);
		e.focusOut(e.second.leaf, null);
		expect(e.marked()).toEqual([]);
		e.focusIn(e.second.leaf);
		expect(e.marked()).toEqual([e.second.el]);
	});

	// Miss-analysis: every held-pointer row sent a mouse's event order, never a tap's.
	it('a tap keeps the mark where it was through its trailing mouse press', () => {
		const e = editor('preview-block');
		e.focusIn(e.first.leaf);
		const send = (type: string) =>
			e.second.leaf.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
		send('pointerdown');
		send('pointerup');
		send('mousedown');
		e.focusIn(e.second.leaf);
		expect(e.marked()).toEqual([e.first.el]);
		send('mouseup');
		expect(e.marked()).toEqual([e.second.el]);
		send('click');
		expect(e.marked()).toEqual([e.second.el]);
	});

	// A tap that sends no mouse events (a long press, a cancelled touch) must not leave the
	// focus mark held until a `click` that never comes.
	it('a tap with no trailing mouse events holds nothing past the lift', () => {
		const e = editor('preview-block');
		e.focusIn(e.first.leaf);
		const send = (type: string) =>
			e.second.leaf.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
		send('pointerdown');
		send('contextmenu');
		send('pointerup');
		e.focusIn(e.second.leaf);
		expect(e.marked()).toEqual([e.second.el]);
	});

	it('the window losing focus mid-press repaints the focused block', () => {
		const e = editor('preview-block');
		e.focusIn(e.first.leaf);
		e.second.leaf.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
		e.focusIn(e.second.leaf);
		window.dispatchEvent(new FocusEvent('blur'));
		expect(e.marked()).toEqual([e.second.el]);
	});
});

// Miss-analysis: every mark test ran in a preview mode, so live mode's one marked block, a row
// that shows its source at the caret, had no row, and its reveal was left to `:focus-within`.
describe('editor-root focus attribution: a row that shows its source at the caret', () => {
	const press = (type: string, target: Element) =>
		target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
	const asRow = (leaf: Element, untitled = false) => {
		leaf.setAttribute('data-source-at-caret', '');
		if (untitled) leaf.setAttribute('data-content-empty', '');
	};

	it('live marks the host of a focused row, and of no other block', () => {
		const e = editor('live');
		asRow(e.second.leaf);
		e.focusIn(e.first.leaf);
		expect(e.marked()).toEqual([]);
		e.focusIn(e.second.leaf);
		expect(e.marked()).toEqual([e.second.el]);
		expect(e.moved).toContain(e.second.el);
		e.focusIn(e.first.leaf);
		expect(e.marked()).toEqual([]);
	});

	it('source and reading mark no row', () => {
		for (const mode of ['source', 'reading'] as const) {
			const e = editor(mode);
			asRow(e.second.leaf);
			e.focusIn(e.second.leaf);
			expect(e.marked(), mode).toEqual([]);
		}
	});

	it('a press that focuses a titled row marks it at the release', () => {
		const e = editor('live');
		asRow(e.second.leaf);
		e.focusIn(e.first.leaf);
		press('pointerdown', e.second.leaf);
		e.focusIn(e.second.leaf);
		expect(e.marked()).toEqual([]);
		press('pointerup', e.second.leaf);
		expect(e.marked()).toEqual([e.second.el]);
	});

	// Miss-analysis: the press rows read the hosts' marks alone, so nothing said a press was held to
	// a reader of a row focused before its `focusin`, which WebKit sends after a landing's write.
	it('marks the root while a press is held, in a mode that hides markers', () => {
		for (const mode of ['live', 'preview-block', 'source'] as const) {
			const e = editor(mode);
			press('pointerdown', e.first.leaf);
			expect(e.root.hasAttribute('data-press-held'), mode).toBe(mode !== 'source');
			press('pointerup', e.first.leaf);
			expect(e.root.hasAttribute('data-press-held'), mode).toBe(false);
		}
	});

	it('a press away from a row keeps its mark until the release', () => {
		const e = editor('live');
		asRow(e.second.leaf);
		e.focusIn(e.second.leaf);
		press('pointerdown', e.first.leaf);
		e.focusIn(e.first.leaf);
		expect(e.marked()).toEqual([e.second.el]);
		press('pointerup', e.first.leaf);
		expect(e.marked()).toEqual([]);
	});

	it('a press that focuses an untitled row leaves the block it left marked until the release', () => {
		const e = editor('preview-block');
		asRow(e.second.leaf, true);
		e.focusIn(e.first.leaf);
		press('pointerdown', e.second.leaf);
		e.focusIn(e.second.leaf);
		expect(e.marked()).toEqual([e.first.el]);
		press('pointerup', e.second.leaf);
		expect(e.marked()).toEqual([e.second.el]);
	});
});
