/**
 * The one mounting seam for decoration widget specs — block badges and inline
 * islands both go through here, so a spec's error containment and teardown
 * semantics can't drift between tiers.
 */

import { mount, unmount } from 'svelte';
import type { Decoration, DecorationWidgetSpec } from './types';

export interface DecorationWidgetHandle {
	el: HTMLElement;
	/** Unmounts the component (if any) and detaches `el`. Idempotent. */
	destroy(): void;
}

/**
 * Build a widget spec's DOM. A synchronous throw (component mount or buildDom)
 * is contained: routed to `reportError` and surfaced as null so the caller
 * renders without the widget instead of tearing down the block.
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
			return {
				el,
				destroy: () => {
					void unmount(instance);
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
