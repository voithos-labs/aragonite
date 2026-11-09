// A log of what the editor called on a DOM block view, and a plugin whose `@@ ` line is one block
// drawn by a view a suite hands it.
import {
	definePlugin,
	type BlockView,
	type BlockViewHandle,
	type BlockViewState,
	type EditorPlugin
} from '#lib/plugin.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';

export interface ViewLog {
	mounts: HTMLElement[];
	updates: BlockViewState[];
	/** Each update's raw as it arrived; `state.node` is the live node. */
	raws: string[];
	destroys: number;
}

export const newViewLog = (): ViewLog => ({ mounts: [], updates: [], raws: [], destroys: 0 });

/** Records the lifecycle into `log`, and lets a row add to the handle. */
export function loggedHandle<H extends BlockViewHandle>(
	log: ViewLog,
	target: HTMLElement,
	extra: H = {} as H
): H {
	log.mounts.push(target);
	return {
		update: (state: BlockViewState) => {
			log.updates.push(state);
			log.raws.push(state.node.raw);
		},
		destroy: () => {
			log.destroys++;
		},
		...extra
	};
}

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
