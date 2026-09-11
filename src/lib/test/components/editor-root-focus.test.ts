// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createFocusAttribution } from '$lib/components/editor-root-focus';
import type { PresentationMode } from '$lib/presentation-mode';

const teardowns: (() => void)[] = [];

afterEach(() => {
	teardowns.splice(0).forEach((teardown) => teardown());
	document.body.replaceChildren();
});

// Miss-analysis: the pin and the attribute were only ever asserted through a mounted editor
// under one mode, so nothing pinned the focusout-within-root keep or the mode re-apply alone.
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
	const attribution = createFocusAttribution({
		get mode() {
			return current;
		}
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
		setMode: (next: PresentationMode) => (current = next)
	};
}

describe('editor-root focus attribution — the per-level pin', () => {
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

	it('teardown detaches the listeners', () => {
		const e = editor();
		e.teardown();
		e.focusIn(e.first.leaf);
		expect(e.attribution.getFocusedPath()).toBeNull();
	});
});

describe('editor-root focus attribution — data-focused', () => {
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

	it('moving focus between hosts moves the mark; leaving the root drops it', () => {
		const e = editor('preview-inline');
		e.focusIn(e.first.leaf);
		e.focusIn(e.second.leaf);
		expect(e.marked()).toEqual([e.second.el]);
		e.focusOut(e.second.leaf, e.outside);
		expect(e.marked()).toEqual([]);
	});
});
