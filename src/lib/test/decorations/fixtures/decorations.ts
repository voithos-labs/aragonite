/** Decoration literals for the engine suites. `stubWidget`'s DOM is never built: only the
 *  render path mounts a widget, and the engine routes islands by type and path alone. */

import type { Decoration, DecorationWidgetSpec } from '$lib/decorations/types';

export const stubWidget: DecorationWidgetSpec = { buildDom: () => ({}) as HTMLElement };

export const mark = (path: number[]): Decoration => ({
	type: 'mark',
	path,
	start: 0,
	end: 1,
	class: 'x'
});

export const widget = (path: number[], offset: number): Decoration => ({
	type: 'widget',
	path,
	offset,
	widget: stubWidget
});

export const replace = (path: number[], start: number, end: number): Decoration => ({
	type: 'replace',
	path,
	start,
	end
});
