import { describe, expect, it } from 'vitest';
import {
	hidesDelimitersAtCaret,
	isReadingMode,
	type PresentationMode
} from '#lib/presentation-mode.js';
import type { InlineWidgetComponentProps } from '#lib/plugin.js';
import type { ViewWidgetPoolDeps } from '#lib/components/blocks/widget-portal.js';
import type { TextRenderDeps } from '#lib/components/blocks/text/text-render.js';
import type { CellRenderDeps } from '#lib/components/blocks/table/cell-render.js';
import type { GlobalCommandContext } from '#lib/schema/commands.js';
import type { GapStopScope } from '#lib/selection/gap-caret.js';

// Keyed by the union, so a new mode fails `npm run check` here until someone decides whether a
// rewrite at its caret may drop delimiter bytes.
const HIDES_AT_CARET: Record<PresentationMode, boolean> = {
	source: false,
	'preview-block': false,
	'preview-inline': false,
	live: true,
	reading: true
};

describe('hidesDelimitersAtCaret', () => {
	for (const [mode, hides] of Object.entries(HIDES_AT_CARET)) {
		it(`${mode} ${hides ? 'hides' : 'draws'} the caret block's delimiters`, () => {
			expect(hidesDelimitersAtCaret(mode as PresentationMode)).toBe(hides);
		});
	}
});

// Every route that hands down a value the editor owns (its theme, its mode, its document reads)
// carries the editor's getter, so no reader can default one of its own.
type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
type NoneOptional<T> = [OptionalKeys<T>] extends [never] ? true : false;
type IsRequired<T, K extends keyof T> = object extends Pick<T, K> ? false : true;

export const widgetPropsAllRequired: NoneOptional<InlineWidgetComponentProps> = true;
export const widgetPoolAllRequired: NoneOptional<ViewWidgetPoolDeps> = true;
export const textRenderAllRequired: NoneOptional<TextRenderDeps> = true;
export const cellRenderAllRequired: NoneOptional<CellRenderDeps> = true;
export const commandModeRequired: IsRequired<GlobalCommandContext, 'getPresentationMode'> = true;
export const gapScopeModeRequired: IsRequired<GapStopScope, 'getPresentationMode'> = true;

/** Never called: `npm run check` fails once the directive inside goes unused. */
export function compileTimePins(): boolean {
	// @ts-expect-error a missing mode getter is not source mode
	return isReadingMode(undefined);
}
