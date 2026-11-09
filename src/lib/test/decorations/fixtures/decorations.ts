/** Decoration objects for these suites. `stubWidget` never draws: only the render path mounts a
 *  widget, and the code here routes them by type and path alone. */

import type { Decoration, DecorationWidgetSpec } from '#lib/decorations/types.js';
import type { DecorationEngine } from '#lib/decorations/decoration-state.svelte.js';
import type { BlockPaint } from '#lib/decorations/block-paint.js';
import { parse } from '#lib/core/parser.js';

export const stubWidget: DecorationWidgetSpec = { view: () => ({}) };

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

/** A path's paint from an engine whose sources all answer by path, so any node stands in. */
export function paintAt(engine: DecorationEngine, path: number[]): BlockPaint {
	return engine.paintOf(STAND_IN, path);
}

const STAND_IN = parse('stand-in\n').children[0];
