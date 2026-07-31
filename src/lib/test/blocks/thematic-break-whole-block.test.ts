// @vitest-environment jsdom
//
// ThematicBreakBlock is the reference whole-block-focus kind (docs/design/editor.md § 8): the
// block IS its own focus target. The key TAIL's semantics belong to `whole-block-keys.test.ts`
// and the caret-adjacent Backspace fallback to `block-edit-core.test.ts`; what only a mount can
// show is this component's own wiring — the focus surface it publishes, and the three-tier
// keydown order (editor-global chord → kind keymap → tail) with its local reading gate.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ThematicBreakBlock from '$lib/components/blocks/ThematicBreakBlock.svelte';
import type { EditorServices } from '$lib/editor-keys';
import type { PresentationMode } from '$lib/presentation-mode';
import { displayLength } from '$lib/core/lines';
import { parse } from '$lib/core/parser';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { makeStubBlockEdit, makeStubFocus } from '../harness/editor-actions';
import { editorMountContext } from '../harness/mount-context';

const RAW = '---\n';
const INDEX = 1;

function mountBreak(presentationMode: PresentationMode = 'source') {
	const doc = parse(`a\n\n${RAW}\nb\n`);
	// Kind dispatch reads the node, so a fixture drift would silently mount this component
	// over a paragraph and leave every assertion below still passing.
	expect(doc.children[INDEX].kind).toBe('thematicBreak');
	const blockEdit = makeStubBlockEdit();
	const focus = makeStubFocus();
	const history = { requestUndo: vi.fn(), requestRedo: vi.fn() };
	const reorder = { nudgeReorderUnit: vi.fn() } as unknown as EditorServices['reorder'];
	const selection = createSelectionState();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ThematicBreakBlock, {
		target,
		props: { node: doc.children[INDEX], index: INDEX, myPath: [INDEX] },
		context: editorMountContext({
			blockEdit,
			focus,
			history,
			doc: { doc: () => doc },
			services: { reorder, selection },
			policies: { presentationMode: () => presentationMode }
		})
	});
	flushSync();
	const el = target.querySelector('.thematic-break-block') as HTMLElement;
	return { instance, el, blockEdit, focus, history, reorder, selection };
}

function press(el: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
	const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	el.dispatchEvent(event);
	return event;
}

let mounted: ReturnType<typeof mountBreak>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('thematic break — the whole-block focus surface', () => {
	it('renders a keyboard-reachable separator and declares itself non-editable', () => {
		mounted = mountBreak();

		expect(mounted.el.getAttribute('role')).toBe('separator');
		expect(mounted.el.getAttribute('tabindex')).toBe('0');
		expect(mounted.el.querySelector('hr')).not.toBeNull();
		expect(mounted.instance.editable).toBe(false);
		expect(mounted.instance.focusable).toBe(true);
	});

	it('parks the caret on the block itself, and reports an offset only while it holds focus', () => {
		mounted = mountBreak();
		expect(mounted.instance.getCursorOffset()).toBeNull();

		mounted.instance.parkCaret(0);

		expect(document.activeElement).toBe(mounted.el);
		expect(mounted.instance.getCursorOffset()).toBe(0);
	});

	// `focus` owes the range-ending `parkCaret` skips: a whole-block landing seats no DOM
	// caret, so a live cross-block range would survive it and the next keystroke type-replaces.
	it('ends a live cross-block range when focused, unlike the bare park', () => {
		mounted = mountBreak();
		mounted.selection.enterCrossBlock({ path: [0], offset: 0 }, { path: [4], offset: 1 });

		mounted.instance.focus(0);

		expect(mounted.selection.isCrossBlock).toBe(false);
		expect(document.activeElement).toBe(mounted.el);
	});
});

describe('thematic break — keydown tiers', () => {
	// Two rows, not five: the tail's own suite owns every branch's semantics, and the only
	// distinction this layer adds is that the edit arm gates on reading mode while nav never does.
	it.each([
		['source', 1],
		['reading', 0]
	] as const)(
		'in %s mode Enter splits %i time(s) and ArrowDown always traverses',
		(mode, splits) => {
			mounted = mountBreak(mode);

			expect(press(mounted.el, { key: 'Enter' }).defaultPrevented).toBe(true);
			press(mounted.el, { key: 'ArrowDown' });

			expect(vi.mocked(mounted.blockEdit.splitBlock).mock.calls).toEqual(
				splits ? [[INDEX, displayLength(RAW)]] : []
			);
			expect(mounted.focus.moveFocus).toHaveBeenCalledTimes(1);
			expect(mounted.focus.moveFocus).toHaveBeenCalledWith(INDEX + 1, {
				stickyColumnFrom: 'above'
			});
		}
	);

	it.each([
		['ArrowUp', -1],
		['ArrowDown', 1]
	] as const)('Alt+%s reorders through the kind keymap instead of traversing', (key, dir) => {
		mounted = mountBreak();

		expect(press(mounted.el, { key, altKey: true }).defaultPrevented).toBe(true);

		expect(mounted.reorder.nudgeReorderUnit).toHaveBeenCalledWith([INDEX], dir);
		expect(mounted.focus.moveFocus).not.toHaveBeenCalled();
	});

	// A whole-block-focus kind has no editable surface to catch undo, so the command tiers on
	// this handler are the only route to it while the block itself holds focus.
	it('honors an editor-global chord while the block itself holds focus', () => {
		mounted = mountBreak();

		expect(press(mounted.el, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);

		expect(mounted.history.requestUndo).toHaveBeenCalledTimes(1);
	});

	// What the local global-chord arm is FOR: `dispatchKeyCommand` dead-keys the whole vocabulary
	// in reading mode by declining, which would leave the chord unconsumed and the browser's
	// native undo free to fire on a document the reader cannot edit.
	it('dead-keys an editor-global chord in reading mode while still consuming it', () => {
		mounted = mountBreak('reading');

		expect(press(mounted.el, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);

		expect(mounted.history.requestUndo).not.toHaveBeenCalled();
	});
});
