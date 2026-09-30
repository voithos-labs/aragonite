// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
	createMenuPresence,
	MENU_OPENED_IN_READING,
	type MenuPresence
} from '$lib/components/menu/menu-presence.svelte';
import { takeDevWarns } from '../support/warn-gate';

/** Mounts one menu element with `close`, returning its unmount. */
function mountMenu(
	presence: MenuPresence,
	close: () => void = () => {},
	opts?: { edits?: boolean }
): () => void {
	return presence.track(close, opts)(document.createElement('div')) as () => void;
}

// The count `menuChange` reads: a menu swapped for another, or a flyout closing over its parent,
// must not read closed while one is still up.
describe('menu presence', () => {
	it('reads open while any tracked menu is mounted, closed once the last one unmounts', () => {
		const presence = createMenuPresence({ isReading: () => false });
		expect(presence.isOpen).toBe(false);

		const unmountMenu = mountMenu(presence);
		const unmountFlyout = mountMenu(presence);
		unmountFlyout();
		expect(presence.isOpen).toBe(true);

		unmountMenu();
		expect(presence.isOpen).toBe(false);
	});

	it('closeAll calls the close of every mounted menu, and of none that unmounted', () => {
		const presence = createMenuPresence({ isReading: () => false });
		const menu = vi.fn();
		const flyout = vi.fn();
		const gone = vi.fn();
		mountMenu(presence, menu);
		mountMenu(presence, flyout);
		mountMenu(presence, gone)();

		presence.closeAll();

		expect([menu, flyout, gone].map((close) => close.mock.calls.length)).toEqual([1, 1, 0]);
	});
});

// Miss-analysis: each menu checked reading mode at its own open, and nothing caught one that forgot.
describe('a menu opened in reading mode', () => {
	it('closes at once and warns when its rows write', () => {
		const presence = createMenuPresence({ isReading: () => true });
		const close = vi.fn();

		mountMenu(presence, close, { edits: true });

		expect(close).toHaveBeenCalledTimes(1);
		expect(takeDevWarns().map((w) => w.tag)).toEqual([MENU_OPENED_IN_READING]);
	});

	it('stays open when its rows only read', () => {
		const presence = createMenuPresence({ isReading: () => true });
		const close = vi.fn();

		mountMenu(presence, close);

		expect(close).not.toHaveBeenCalled();
		expect(presence.isOpen).toBe(true);
	});

	it('an editing menu outside reading mode stays open', () => {
		const presence = createMenuPresence({ isReading: () => false });
		const close = vi.fn();

		mountMenu(presence, close, { edits: true });

		expect(close).not.toHaveBeenCalled();
	});
});
