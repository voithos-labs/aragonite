/**
 * A React root in an element the editor made for a plugin view. It renders synchronously, so what
 * the component draws is in place by the time the editor's call returns, and it unmounts after the
 * host app's commit, since the editor's teardown can land inside one.
 */

import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

export type Wrap = (view: ReactNode) => ReactNode;

export interface ViewRoot {
	render(node: ReactNode): void;
	/** Settles once the root is gone; a throw while unmounting rejects it. */
	unmount(): Promise<void>;
}

export function createViewRoot(target: HTMLElement, wrap: Wrap | undefined): ViewRoot {
	const root = createRoot(target);
	return {
		render(node) {
			flushSync(() => root.render(wrap ? wrap(node) : node));
		},
		// React refuses to unmount a root inside its own commit; the editor never reuses `target`,
		// so a microtask later is safe.
		unmount: () => Promise.resolve().then(() => root.unmount())
	};
}
