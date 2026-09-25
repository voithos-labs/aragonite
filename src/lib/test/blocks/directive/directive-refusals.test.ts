// @vitest-environment jsdom
//
// What `createContainerBlock`'s optional dependencies mean when a plugin passes none of them.
// Each helper has its own unit test proving it refuses; none shows what that refusal looks
// like in a mounted component, and the generic directive container is the only shipped one
// that takes all those branches at once. The failure they guard is quiet and uniform: a
// container that starts handling keys or writing bytes where it should have done nothing.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { EditorServices } from '$lib/editor-keys';
import { makeStubFocus } from '../../harness/editor-actions';
import { installDirectiveStubs, mountDirective, type MountedDirective } from './mount-directive';
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { dispatchKey } from '$lib/test/harness/settle';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => allowDevWarns(['block-host']));

beforeAll(installDirectiveStubs);

const BODY = ':::foo\nalpha\n\nbeta\n:::\n';

function mountWithSpies() {
	const reorder = { nudgeReorderUnit: vi.fn() };
	const focus = makeStubFocus();
	const mounted = mountDirective(BODY, {
		focus,
		services: { reorder: reorder as unknown as EditorServices['reorder'] }
	});
	return { ...mounted, reorder, focus };
}

let mounted: MountedDirective | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

describe('an unconfigured container does nothing where the dispatch declines', () => {
	// A kind that declares no `reservedChrome` is never collapsed, so `expandCollapsed` refuses.
	// Opening anyway would add an undo entry to a container that has no collapsed state.
	it('reveals a body child without committing a byte to open it', async () => {
		mounted = mountDirective(BODY);

		const child = await mounted.containerApi.revealByPath([1]);

		expect(child?.editable).toBe(true);
		expect(mounted.blockEdit.updateBlockMetadata).not.toHaveBeenCalled();
	});

	// A plugin container has no built-in kind commands, so its `runCommand` does nothing and the
	// key has to keep travelling up to whatever does own it.
	it('leaves a chord it has no command for to the level above', () => {
		mounted = mountDirective(BODY);

		expect(dispatchKey(mounted.box, { key: 'k', ctrlKey: true }).defaultPrevented).toBe(false);
		expect(dispatchKey(mounted.box, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(false);
	});

	// A modifier being held is part of a chord, not a keystroke; `eventToChord` returns
	// null and the box must not treat the hold as an action.
	it('treats a held modifier as no chord at all', () => {
		mounted = mountDirective(BODY);

		expect(dispatchKey(mounted.box, { key: 'Control', ctrlKey: true }).defaultPrevented).toBe(
			false
		);
		expect(dispatchKey(mounted.box, { key: 'Shift', shiftKey: true }).defaultPrevented).toBe(false);
	});

	// Whole-block Enter and Backspace belong to opaque containers that opt in with `getFocusEl`.
	// Without that check, a key reaching the box would split the entire container under a caret.
	it('grows no whole-block Enter or Backspace without a focus surface', () => {
		const m = mountWithSpies();
		mounted = m;

		expect(dispatchKey(m.box, { key: 'Enter' }).defaultPrevented).toBe(false);
		expect(dispatchKey(m.box, { key: 'Backspace' }).defaultPrevented).toBe(false);
		expect(dispatchKey(m.box, { key: 'Delete' }).defaultPrevented).toBe(false);

		expect(m.blockEdit.splitBlock).not.toHaveBeenCalled();
		expect(m.blockEdit.deleteBlock).not.toHaveBeenCalled();
		expect(m.focus.moveFocus).not.toHaveBeenCalled();
	});

	// Alt-arrow reorder sits inside the same check, so it refuses for the same reason: without a
	// focus element a container is reordered through its parent's BlockList.
	it('grows no Alt-arrow reorder without a focus surface', () => {
		const m = mountWithSpies();
		mounted = m;

		expect(dispatchKey(m.box, { key: 'ArrowUp', altKey: true }).defaultPrevented).toBe(false);
		expect(dispatchKey(m.box, { key: 'ArrowDown', altKey: true }).defaultPrevented).toBe(false);

		expect(m.reorder.nudgeReorderUnit).not.toHaveBeenCalled();
	});
});
