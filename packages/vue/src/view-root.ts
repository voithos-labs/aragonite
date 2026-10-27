/**
 * A Vue render tree in an element the editor made for a plugin view, patched synchronously through
 * `render`, so what the component draws is in place by the time the editor's call returns.
 */

import { render, type App, type VNode } from 'vue';

export interface ViewRoot {
	render(vnode: VNode): void;
	unmount(): void;
}

/** Inside `app`'s context when given: its `provide`s, global components and plugins. */
export function createViewRoot(target: HTMLElement, app: App | undefined): ViewRoot {
	return {
		render(vnode) {
			vnode.appContext = app?._context ?? null;
			render(vnode, target);
		},
		unmount: () => render(null, target)
	};
}
