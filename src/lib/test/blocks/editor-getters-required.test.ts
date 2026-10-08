/**
 * Type pins for the values the editor owns (its theme, its mode, its document reads): every route
 * that hands one down carries the editor's getter, so no reader can default one of its own. The
 * annotations are the assertions; `npm run check` fails the day one of these turns optional.
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import type { InlineWidgetComponentProps } from '#lib/plugin.js';
import type { SvelteWidgetPoolDeps } from '#lib/components/blocks/widget-portal.js';
import type { TextRenderDeps } from '#lib/components/blocks/text/text-render.js';
import type { CellRenderDeps } from '#lib/components/blocks/table/cell-render.js';
import type { GlobalCommandContext } from '#lib/schema/commands.js';
import type { GapStopScope } from '#lib/selection/gap-caret.js';
import { isReadingMode } from '#lib/presentation-mode.js';
import { makeRenderHarness, blockNode } from '#lib/test/harness/text-render.js';

type OptionalKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? K : never }[keyof T];
type NoneOptional<T> = [OptionalKeys<T>] extends [never] ? true : false;
type IsRequired<T, K extends keyof T> = object extends Pick<T, K> ? false : true;

export const widgetPropsAllRequired: NoneOptional<InlineWidgetComponentProps> = true;
export const widgetPoolAllRequired: NoneOptional<SvelteWidgetPoolDeps> = true;
export const textRenderAllRequired: NoneOptional<TextRenderDeps> = true;
export const cellRenderAllRequired: NoneOptional<CellRenderDeps> = true;
export const commandModeRequired: IsRequired<GlobalCommandContext, 'getPresentationMode'> = true;
export const gapScopeModeRequired: IsRequired<GapStopScope, 'getPresentationMode'> = true;

export function modeCheckWithoutGetterRejected(): boolean {
	// @ts-expect-error a missing mode getter is not source mode
	return isReadingMode(undefined);
}

describe('the editor getters a render passes down', () => {
	it('are passed explicitly by a text render built outside an editor', () => {
		const { deps } = makeRenderHarness(blockNode('x\n'), { theme: 'light' });
		expect(deps.getTheme()).toBe('light');
	});
});
