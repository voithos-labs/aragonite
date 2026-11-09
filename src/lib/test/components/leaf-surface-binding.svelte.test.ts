// @vitest-environment jsdom
// The hand-applied leaf bundle behaves as Svelte's spread does: attributes follow the bundle, an
// attachment re-runs only when its own function changes, and a key it can't bind is refused.
// Miss-analysis: new module; the editor-level rows can't see an attachment re-run a blur hides.
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { bindLeafSurface } from '#lib/components/drawn-block/leaf-surface-binding.svelte.js';

let teardown: (() => void) | null = null;
afterEach(() => {
	teardown?.();
	teardown = null;
});

function bound(bundle: () => Record<string | symbol, unknown>, el = document.createElement('div')) {
	let current: HTMLElement | null = $state(null);
	teardown = $effect.root(() => {
		bindLeafSurface({ getEl: () => current, props: bundle });
	});
	current = el;
	flushSync();
	return el;
}

describe('bindLeafSurface', () => {
	it('sets the attributes, follows a changed value, and removes one that leaves', () => {
		const attrs = $state<{ role?: string; label?: string }>({ role: 'textbox', label: 'a' });
		const el = bound(() => ({ role: attrs.role, 'aria-label': attrs.label }));
		expect(el.getAttribute('role')).toBe('textbox');
		attrs.label = 'b';
		flushSync();
		expect(el.getAttribute('aria-label')).toBe('b');
		attrs.role = undefined;
		flushSync();
		expect(el.hasAttribute('role')).toBe(false);
	});

	// Miss-analysis: every row bound one element for its whole life; none detached it.
	it('takes its attributes off an element it detaches, so the old one stops being editable', () => {
		let current: HTMLElement | null = $state(null);
		teardown = $effect.root(() => {
			bindLeafSurface({
				getEl: () => current,
				props: () => ({ contenteditable: 'true', role: 'textbox' })
			});
		});
		const first = document.createElement('div');
		first.setAttribute('class', 'kept');
		current = first;
		flushSync();
		current = null;
		flushSync();
		expect(first.hasAttribute('contenteditable')).toBe(false);
		expect(first.hasAttribute('role')).toBe(false);
		expect(first.getAttribute('class')).toBe('kept');
	});

	it('binds every on-key as a listener, a key it was never told about included', () => {
		const seen: string[] = [];
		const el = bound(() => ({
			oninput: () => seen.push('input'),
			onbrandnewevent: () => seen.push('brand-new')
		}));
		el.dispatchEvent(new Event('input'));
		el.dispatchEvent(new Event('brandnewevent'));
		expect(seen).toEqual(['input', 'brand-new']);
	});

	it('re-runs an attachment when its function changes, never when an attribute does', () => {
		const key = Symbol('attachment');
		const runs: string[] = [];
		const first = () => {
			runs.push('first');
		};
		const second = () => {
			runs.push('second');
		};
		const s = $state({ label: 'a', attach: first as () => void });
		bound(() => ({ 'aria-label': s.label, [key]: s.attach }));
		s.label = 'b';
		flushSync();
		expect(runs).toEqual(['first']);
		s.attach = second;
		flushSync();
		expect(runs).toEqual(['first', 'second']);
	});

	it('refuses a capture listener rather than binding it in the bubble phase', () => {
		expect(() => bound(() => ({ onkeydowncapture: () => {} }))).toThrow(/onkeydowncapture/);
	});
});
