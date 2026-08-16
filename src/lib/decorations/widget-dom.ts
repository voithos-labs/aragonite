/**
 * The one mounting seam for decoration widget specs, so error containment and teardown
 * semantics can't drift between block badges and inline islands.
 */

import { mount, unmount } from 'svelte';
import type { Decoration, DecorationWidgetSpec } from './types';

export interface DecorationWidgetHandle {
	el: HTMLElement;
	/** Unmounts the component (if any) and detaches `el`. Idempotent. */
	destroy(): void;
}

/**
 * Build a widget spec's DOM. A synchronous throw is contained and surfaced as null, so the
 * caller renders without the widget instead of tearing down the block.
 */
export function mountDecorationWidget(
	spec: DecorationWidgetSpec,
	dec: Decoration,
	reportError?: (error: unknown) => void
): DecorationWidgetHandle | null {
	try {
		if ('component' in spec) {
			const el = document.createElement('span');
			const instance = mount(spec.component, { target: el, props: { decoration: dec } });
			// The flag is what makes the documented idempotence real: a second `unmount` of the same
			// instance is not a no-op the way a second `remove()` is.
			let unmounted = false;
			return {
				el,
				destroy: () => {
					if (!unmounted) void unmount(instance);
					unmounted = true;
					el.remove();
				}
			};
		}
		const el = spec.buildDom(dec);
		return { el, destroy: () => el.remove() };
	} catch (error) {
		reportError?.(error);
		return null;
	}
}
