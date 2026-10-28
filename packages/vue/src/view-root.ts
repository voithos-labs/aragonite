/**
 * A Vue render tree in an element the editor made for a plugin view, patched synchronously through
 * `render`, so what the component draws is in place by the time the editor's call returns.
 */

import { defineComponent, h, onErrorCaptured, render, type App, type VNode } from 'vue';

export interface ViewRoot {
	/** Throws what the component threw while rendering, its setup, refs and hooks included. */
	render(vnode: VNode): void;
	/** Throws what a component threw while unmounting. */
	unmount(): void;
}

/** Inside `app`'s context when given: its `provide`s, global components and plugins. */
export function createViewRoot(target: HTMLElement, app: App | undefined): ViewRoot {
	// A production build logs a throw instead of rethrowing it, so the editor's error event would
	// never see it; one that lands later goes on to the app's own error handling.
	let caught: unknown[] | null = null;
	const Catch = defineComponent({
		props: { view: { type: Object as () => VNode, required: true } },
		setup(props) {
			onErrorCaptured((error) => {
				if (!caught) return;
				caught.push(error);
				return false;
			});
			return () => props.view;
		}
	});
	function rethrowing(run: () => void): void {
		const thrown: unknown[] = [];
		caught = thrown;
		try {
			run();
		} finally {
			caught = null;
		}
		if (thrown.length > 0) throw thrown[0];
	}
	return {
		render(view) {
			const root = h(Catch, { view });
			root.appContext = app?._context ?? null;
			rethrowing(() => render(root, target));
		},
		unmount: () => rethrowing(() => render(null, target))
	};
}
