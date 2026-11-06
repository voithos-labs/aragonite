/** What a pointer press means for the inline widget the editor holds selected. */

import { widgetSourceRange } from '../core/inline/widget-shell';
import { findSurfacePathForElement } from './path-lookup';
import type { SelectionState } from './selection-state.svelte';

/** Whether a press lands on the widget the editor holds selected. */
export function pressesSelectedWidget(
	selection: Pick<SelectionState, 'widgetIn'>,
	target: EventTarget | null
): boolean {
	const el =
		target instanceof Element ? target.closest('[data-inline-widget][data-source-start]') : null;
	const source = el && widgetSourceRange(el);
	const path = el && findSurfacePathForElement(el);
	return source !== null && path != null && selection.widgetIn(path)?.sourceStart === source.start;
}
