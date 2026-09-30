/**
 * A mention menu on `@` whose `onCommit` waits on the page before it inserts a card below, the
 * shape a source takes when it fetches a title first. The spec releases the wait through
 * `window.__releaseHeldCommit`, so it can type while the pick's commit is still pending.
 */
import { definePlugin } from '$lib/plugin';
import type { EditorPlugin } from '$lib/plugin';

declare global {
	interface Window {
		__releaseHeldCommit?: () => void;
	}
}

export const HELD_COMMIT_MENU = 'harness-held-commit';

export function heldCommitMenuPlugin(): EditorPlugin {
	return definePlugin({
		name: 'harness-held-commit-menu',
		setup(ctx) {
			ctx.onEditor((editor) => {
				const handle = editor.inlineMenus.addSource({
					name: HELD_COMMIT_MENU,
					trigger: '@',
					items: () => [{ id: 'ada', label: 'Ada', insert: '@Ada' }],
					onCommit: async () => {
						await new Promise<void>((release) => (window.__releaseHeldCommit = release));
						await editor.insertMarkdown('> card', { placement: 'below' });
					}
				});
				return () => handle.dispose();
			});
		}
	});
}
