// A plugin whose `@@ ` line is one block drawn by a view a suite hands it.
import { definePlugin, type BlockView, type EditorPlugin } from '#lib/plugin.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';

export const MARKER_LINE = '@@ ';

/** A plugin whose `@@ ` line is one block drawn by `view`. */
export function markerLeafPlugin(view: BlockView, name = 'dom-view-leaf'): EditorPlugin {
	return definePlugin({
		name,
		setup: () => {
			testLeaf(name, (kind) => ({
				opener: {
					priority: 25,
					interruptsParagraph: false,
					tryOpen: (ctx) =>
						ctx.line.text.startsWith(MARKER_LINE)
							? {
									node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw },
									consumed: 1
								}
							: null
				},
				view
			}));
		}
	});
}
