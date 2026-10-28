/**
 * A React root in an element the editor made for a plugin view. It renders synchronously, so what
 * the component draws is in place by the time the editor's call returns, and it unmounts after the
 * host app's commit, since the editor's teardown can land inside one.
 */

import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

export interface ViewRoot {
	/** Throws what the component threw while rendering, its refs and layout effects included. */
	render(node: ReactNode): void;
	/** Settles once the root is gone; a throw in a cleanup rejects it. */
	unmount(): Promise<void>;
}

export function createViewRoot(
	target: HTMLElement,
	wrap: ((view: ReactNode) => ReactNode) | undefined
): ViewRoot {
	// React 19 reports a throw instead of rethrowing it, so the editor's error event would never
	// see it; React 18 rethrows on its own and ignores the option.
	let caught: unknown[] | null = null;
	const root = createRoot(target, {
		onUncaughtError(error) {
			if (caught) caught.push(error);
			else reportError(error);
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
		render(node) {
			rethrowing(() => flushSync(() => root.render(wrap ? wrap(node) : node)));
		},
		// React refuses to unmount a root inside its own commit; the editor never reuses `target`,
		// so a microtask later is safe.
		unmount: () => Promise.resolve().then(() => rethrowing(() => root.unmount()))
	};
}
