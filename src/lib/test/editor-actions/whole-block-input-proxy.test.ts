// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { allowDevWarns, takeDevWarns } from '$lib/test/support/warn-gate';
import { serialize } from '$lib/core/serializer';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import { fixtureReading } from '$lib/test/harness/fixture-grammar';
import { settleEditor } from '$lib/test/harness/settle';
import { createContainerBlockComponent } from '$lib/editor-actions/container-block-component';
import {
	WHOLE_BLOCK_INPUT_ATTR,
	composeWholeBlockFocusSurface,
	createWholeBlockInputProxy,
	holdsWholeBlockFocus,
	isEditableEventTarget,
	isWholeBlockInputProxy,
	type WholeBlockInputProxy
} from '$lib/editor-actions/whole-block-focus-surface';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';
import { makeShimDeps, makeTopHarness } from '$lib/test/harness/editor-actions';

// The proxy factory mounts its host in `onMount`; outside a component the test runs the callback.
const mountCallbacks = vi.hoisted(() => [] as (() => unknown)[]);
vi.mock('svelte', async (original) => ({
	...(await original<typeof import('svelte')>()),
	onMount: (fn: () => unknown) => mountCallbacks.push(fn)
}));

// The hidden editing host is contenteditable, so every check that asks "is a plugin's own
// editor holding this?" would answer yes about the editor's own host. These are the three
// places that would then go wrong: the focus-element composition, the component's focus
// placement, and the component's cursor-offset report.

function attach<T extends HTMLElement>(el: T): T {
	document.body.appendChild(el);
	return el;
}

function box(): HTMLElement {
	return attach(document.createElement('div'));
}

function proxyIn(host: HTMLElement): HTMLElement {
	const el = document.createElement('div');
	el.setAttribute(WHOLE_BLOCK_INPUT_ATTR, '');
	el.setAttribute('contenteditable', 'true');
	el.tabIndex = -1;
	host.appendChild(el);
	return el;
}

beforeEach(() => {
	document.body.innerHTML = '';
	mountCallbacks.length = 0;
});

describe('the editing host is not a plugin editable', () => {
	it('is recognized by its attribute and refused by the editable-target guard', () => {
		const el = proxyIn(box());
		expect(isWholeBlockInputProxy(el)).toBe(true);
		expect(isEditableEventTarget(el)).toBe(false);
	});

	it('leaves a real plugin editable answering the guard', () => {
		const textarea = attach(document.createElement('textarea'));
		expect(isWholeBlockInputProxy(textarea)).toBe(false);
		expect(isEditableEventTarget(textarea)).toBe(true);
	});
});

// Without the exclusion the composition reads its own host as the plugin's edit mode and
// withdraws the focus element, so all whole-block key handling dies once the host takes focus.
describe('the composed surface, with the host holding focus', () => {
	// The declared element is deliberately absent, which is the branch that reads activeElement.
	afterEach(() => allowDevWarns(['container-block']));

	it('falls back to the box rather than withdrawing', () => {
		const boxEl = box();
		proxyIn(boxEl).focus();
		const surface = composeWholeBlockFocusSurface(
			() => null,
			() => boxEl,
			() => 'mermaid'
		);
		expect(surface()).toBe(boxEl);
	});
});

describe('holdsWholeBlockFocus', () => {
	it('answers for the declared surface and the host beside it alike', () => {
		const boxEl = box();
		const declared = attach(document.createElement('div'));
		const host = proxyIn(boxEl);

		expect(holdsWholeBlockFocus(declared, host)).toBe(false);
		host.focus();
		expect(holdsWholeBlockFocus(declared, host)).toBe(true);
		declared.tabIndex = 0;
		declared.focus();
		expect(holdsWholeBlockFocus(declared, host)).toBe(true);
	});
});

describe('container shim routing through the host', () => {
	function shim(boxEl: HTMLElement, inputProxy?: WholeBlockInputProxy) {
		return createContainerBlockComponent(
			makeShimDeps([], {
				node: { kind: 'mermaid' as AnyBlockKind, leadingTrivia: '', raw: '' } as CstNode,
				getFocusEl: () => boxEl,
				inputProxy
			})
		);
	}

	it('hands both caret entries to the host instead of focusing the declared surface', () => {
		const boxEl = box();
		const landed: HTMLElement[] = [];
		const host = proxyIn(boxEl);
		const proxy: WholeBlockInputProxy = { el: () => host, focus: (d) => landed.push(d) };

		shim(boxEl, proxy).focus(0);
		shim(boxEl, proxy).focusAtColumn?.(120, 'above');

		expect(landed).toEqual([boxEl, boxEl]);
		expect(document.activeElement).not.toBe(boxEl);
	});

	// Identity against the declared element reported null with focus one sibling away, which
	// reads to every caller as "this block does not hold the caret".
	it('reports offset 0 while the host holds focus, and null once focus leaves the block', () => {
		const boxEl = box();
		const host = proxyIn(boxEl);
		const shimApi = shim(boxEl, { el: () => host, focus: () => host.focus() });

		host.focus();
		expect(shimApi.getCursorOffset()).toBe(0);

		const elsewhere = attach(document.createElement('div'));
		elsewhere.tabIndex = 0;
		elsewhere.focus();
		expect(shimApi.getCursorOffset()).toBeNull();
	});
});

// Miss-analysis: the only label pin mounted a divider, whose name never changes, so no test
// asked whether a name read at mount could go stale.
describe('the editing host names its block', () => {
	it('reads the name again on each focus, so a changed name is the one announced', () => {
		const boxEl = box();
		const declared = attach(document.createElement('div'));
		let label = 'Chart';
		const proxy = createWholeBlockInputProxy({
			getBoxEl: () => boxEl,
			getFocusEl: () => declared,
			isReading: () => false,
			getLabel: () => label,
			mint: () => {}
		});
		mountCallbacks.forEach((run) => run());
		expect(proxy.el()?.getAttribute('aria-label')).toBe('Chart');

		label = 'Diagramme';
		proxy.focus(declared);

		expect(document.activeElement).toBe(proxy.el());
		expect(proxy.el()?.getAttribute('aria-label')).toBe('Diagramme');
	});
});

// Miss-analysis: the proxy's own reading check was never driven, so nothing showed that a
// character reaching the host in reading mode writes no paragraph once the commit owns the check.
describe('the editing host in reading mode', () => {
	it('is not editable, and a character that reaches it anyway writes nothing', async () => {
		const editor = makeTopHarness('---\n', { reading: fixtureReading({}, 'reading') });
		const boxEl = box();
		const proxy = createWholeBlockInputProxy({
			getBoxEl: () => boxEl,
			getFocusEl: () => null,
			isReading: () => true,
			getLabel: () => 'Divider',
			mint: (text) => void editor.actions.insertParagraph(1, text)
		});
		mountCallbacks.forEach((run) => run());
		expect(proxy.el()?.getAttribute('contenteditable')).toBe('false');

		proxy
			.el()!
			.dispatchEvent(
				new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', cancelable: true })
			);
		await settleEditor();

		expect(serialize(editor.doc)).toBe('---\n');
		expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
	});
});
