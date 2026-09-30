// @vitest-environment jsdom
// Tab reaches a list item by bubbling after the inner paragraph declines it, so the item
// dispatches only its kind's commands: resolving global ones would re-run chords the focused
// block already owns, undo among them. A declined key keeps `defaultPrevented` false and leaves
// the `ListContext` untouched.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs } from '$lib/test/harness/mount-editor.svelte';
import { mountItem, type MountedItem } from './mount-item';
import { allowDevWarns } from '$lib/test/support/warn-gate';
import { dispatchKey } from '$lib/test/harness/settle';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => allowDevWarns(['block-host']));

beforeAll(installLayoutStubs);

const NESTABLE = '- alpha\n- beta\n';

let mounted: MountedItem | null = null;
afterEach(async () => {
	if (mounted) await mounted.dispose();
	mounted = null;
	document.body.innerHTML = '';
});

describe('a list item claims its own kind chords and nothing else', () => {
	// The control: the cases below assert that nothing took the key, which a deleted handler
	// would also pass.
	it('claims the chords its kind declares', () => {
		mounted = mountItem(NESTABLE, 1);

		expect(dispatchKey(mounted.content, { key: 'Tab' }).defaultPrevented).toBe(true);
		expect(mounted.listContext.indentItem).toHaveBeenCalledWith(1);

		expect(dispatchKey(mounted.content, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(
			true
		);
		expect(mounted.listContext.unindentItem).toHaveBeenCalledWith(1);
	});

	it('leaves the global chords to the leaf that already owns them', () => {
		mounted = mountItem(NESTABLE, 1);

		for (const init of [
			{ key: 'z', ctrlKey: true },
			{ key: 'z', ctrlKey: true, shiftKey: true },
			{ key: 'y', ctrlKey: true },
			{ key: 'b', ctrlKey: true }
		]) {
			expect(dispatchKey(mounted.content, init).defaultPrevented).toBe(false);
		}
		expect(mounted.listContext.indentItem).not.toHaveBeenCalled();
		expect(mounted.listContext.unindentItem).not.toHaveBeenCalled();
	});

	// `eventToChord` returns null for a held modifier, CapsLock included, so the item takes none.
	it('treats a held modifier as no chord at all', () => {
		mounted = mountItem(NESTABLE, 1);

		for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock']) {
			expect(dispatchKey(mounted.content, { key }).defaultPrevented).toBe(false);
		}
		expect(mounted.listContext.indentItem).not.toHaveBeenCalled();
	});

	// A key the inner block consumed synchronously has already acted, so the item
	// must not run a second action off the same keypress.
	it('ignores a key an inner block already consumed', () => {
		mounted = mountItem(NESTABLE, 1);
		mounted.content.addEventListener('keydown', (e) => e.preventDefault(), { capture: true });

		dispatchKey(mounted.content, { key: 'Tab' });

		expect(mounted.listContext.indentItem).not.toHaveBeenCalled();
	});
});
