// @vitest-environment jsdom
//
// What the container seam's optional deps mean when a plugin supplies NONE of them. Each
// helper has its own unit test proving it declines; none says what the decline looks like at
// a mounted caller, and the generic directive container is the only shipped component that
// takes every one of those branches at once. The failure they guard is uniform and quiet: a
// container that starts CLAIMING keys or COMMITTING where it should have stood down.
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { EditorServices } from '$lib/editor-keys';
import { makeStubFocus } from '../../harness/editor-actions';
import {
	installDirectiveStubs,
	mountDirective,
	pressOn,
	type MountedDirective
} from './mount-directive';
import { expectDevWarns } from '$lib/test/support/warn-gate';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => expectDevWarns(['block-host']));

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

describe('an unconfigured container stands down where the seam declines', () => {
	// A kind declaring no `reservedChrome` is never collapsed, so `expandCollapsed` declines. A
	// door that opened anyway would mint an undo entry on a container with no collapsed state.
	it('reveals a body child without committing a byte to open it', async () => {
		mounted = mountDirective(BODY);

		const child = await mounted.containerApi.revealByPath([1]);

		expect(child?.editable).toBe(true);
		expect(mounted.blockEdit.updateBlockMetadata).not.toHaveBeenCalled();
	});

	// The kind target's `runCommand` is inert by construction — a plugin container owns no
	// built-in kind commands — so the key must keep travelling to the tier that does own it.
	it('leaves a chord it has no command for to the tier above', () => {
		mounted = mountDirective(BODY);

		expect(pressOn(mounted.box, { key: 'k', ctrlKey: true })).toBe(false);
		expect(pressOn(mounted.box, { key: 'z', ctrlKey: true })).toBe(false);
	});

	// A modifier being held is part of a chord, not a keystroke; `eventToChord` returns
	// null and the box must not treat the hold as an action.
	it('treats a held modifier as no chord at all', () => {
		mounted = mountDirective(BODY);

		expect(pressOn(mounted.box, { key: 'Control', ctrlKey: true })).toBe(false);
		expect(pressOn(mounted.box, { key: 'Shift', shiftKey: true })).toBe(false);
	});

	// The whole-block affordances belong to opaque containers that opt in with `getFocusEl`.
	// Were the gate to drop, a key reaching the box would split the WHOLE container under a caret.
	it('grows no whole-block Enter or Backspace without a focus surface', () => {
		const m = mountWithSpies();
		mounted = m;

		expect(pressOn(m.box, { key: 'Enter' })).toBe(false);
		expect(pressOn(m.box, { key: 'Backspace' })).toBe(false);
		expect(pressOn(m.box, { key: 'Delete' })).toBe(false);

		expect(m.blockEdit.splitBlock).not.toHaveBeenCalled();
		expect(m.blockEdit.deleteBlock).not.toHaveBeenCalled();
		expect(m.focus.moveFocus).not.toHaveBeenCalled();
	});

	// Alt-arrow reorder is handled inline in the same gated block, so it shares the refusal:
	// without a focus surface a container is reordered through its parent's BlockList.
	it('grows no Alt-arrow reorder without a focus surface', () => {
		const m = mountWithSpies();
		mounted = m;

		expect(pressOn(m.box, { key: 'ArrowUp', altKey: true })).toBe(false);
		expect(pressOn(m.box, { key: 'ArrowDown', altKey: true })).toBe(false);

		expect(m.reorder.nudgeReorderUnit).not.toHaveBeenCalled();
	});
});
