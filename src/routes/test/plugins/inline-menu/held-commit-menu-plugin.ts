/**
 * A card picker on `@` whose pick waits on the page before it puts a card below in place of the
 * query, the shape a menu takes when it fetches first. The spec releases the wait through
 * `window.__releaseHeldCommit`, so it can type while the pick is still waiting.
 */
import { definePlugin, menu, type MenuRow } from '#lib/plugin.js';

declare global {
	interface Window {
		__releaseHeldCommit?: () => void;
	}
}

export const heldCommitMenuPlugin = definePlugin({
	name: 'harness-held-commit-menu',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		menus: [
			menu<MenuRow>({
				label: 'Mention',
				trigger: '@',
				where: 'anywhere',
				rows: () => [{ label: 'Ada' }],
				async pick(_row, pick) {
					await new Promise<void>((release) => (window.__releaseHeldCommit = release));
					await pick.insertBlock('> card');
				}
			})
		]
	})
});
