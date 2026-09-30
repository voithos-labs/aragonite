// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createMenuPresence } from '$lib/components/menu/menu-presence.svelte';

// The count `menuChange` reads: a menu swapped for another, or a flyout closing over its parent,
// must not read closed while one is still up.
describe('menu presence', () => {
	const mount = (presence: ReturnType<typeof createMenuPresence>) =>
		presence.track(document.createElement('div')) as () => void;

	it('reads open while any tracked menu is mounted, closed once the last one unmounts', () => {
		const presence = createMenuPresence();
		expect(presence.isOpen).toBe(false);

		const unmountMenu = mount(presence);
		const unmountFlyout = mount(presence);
		unmountFlyout();
		expect(presence.isOpen).toBe(true);

		unmountMenu();
		expect(presence.isOpen).toBe(false);
	});
});
