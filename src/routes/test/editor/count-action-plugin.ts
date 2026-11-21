// A plugin value with one selection action, `Shout`, that counts how often its rows are asked for
// in `window.__actionRows`; its one row writes the captured text upper-cased.
import { definePlugin } from '#lib/plugin.js';

declare global {
	interface Window {
		__actionRows?: number;
	}
}

export const countActionPlugin = definePlugin({
	name: 'count-action',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		selectionActions: [
			{
				label: 'Shout',
				icon: 'type',
				rows(captured) {
					window.__actionRows = (window.__actionRows ?? 0) + 1;
					return [
						{
							label: 'Upper',
							run: (draft) =>
								void draft.replace(captured.range, captured.text.toUpperCase()).commit()
						}
					];
				}
			}
		]
	})
});
