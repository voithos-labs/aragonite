// @vitest-environment jsdom
//
// Tab reaches a list item by bubbling: the inner paragraph declines it without calling
// `preventDefault`, so the item's box is the second thing to see a key still travelling. That is
// why the item dispatches kind commands only: resolving global ones here would re-run the chords
// the focused block owns, undo among them. `dispatchKindCommand`'s own tests show it returns
// false; what only a mount shows is what false means here: no `preventDefault`, and a
// `ListContext` nothing touched.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { installLayoutStubs } from '../editor-mount';
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
	// The control. Both cases below say "nothing took this key", and without a key that is
	// taken on the same box, deleting the handler would leave them passing.
	it('claims the chords its kind declares', () => {
		mounted = mountItem(NESTABLE, 1);

		expect(dispatchKey(mounted.content, { key: 'Tab' }).defaultPrevented).toBe(true);
		expect(mounted.listContext.indentItem).toHaveBeenCalledWith(1);

		expect(dispatchKey(mounted.content, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(
			true
		);
		expect(mounted.listContext.unindentItem).toHaveBeenCalledWith(1);
	});

	// Why only kind commands are dispatched here: were global ones resolved too, these
	// chords would run here as well as at the focused block.
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

	// `eventToChord` returns null for a modifier being held. A second copy of this set is how
	// CapsLock once slipped through and cleared the sticky column.
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
