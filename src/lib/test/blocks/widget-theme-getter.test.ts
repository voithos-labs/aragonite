/**
 * Type pins for the theme a widget draws with: every route from the editor to a widget carries the
 * editor's theme getter, so no reader can default a theme of its own. The `@ts-expect-error`
 * directives are the assertions; `npm run check` fails the day a route without it compiles.
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import type { InlineWidgetComponentProps } from '$lib/plugin';
import type { SvelteWidgetPoolDeps } from '$lib/components/blocks/widget-portal';
import type { TextRenderDeps } from '$lib/components/blocks/text/text-render';
import type { CellRenderDeps } from '$lib/components/blocks/table/cell-render';
import { makeRenderHarness, blockNode } from '$lib/test/harness/text-render';

type WithoutTheme<T> = Omit<T, 'getTheme'>;

export function widgetPropsWithoutThemeRejected(
	props: WithoutTheme<InlineWidgetComponentProps>
): InlineWidgetComponentProps {
	// @ts-expect-error a widget reads the editor's theme, never a default of its own
	return props;
}

export function widgetPoolWithoutThemeRejected(
	deps: WithoutTheme<SvelteWidgetPoolDeps>
): SvelteWidgetPoolDeps {
	// @ts-expect-error the widget pool hands every widget the editor's theme getter
	return deps;
}

export function textRenderWithoutThemeRejected(deps: WithoutTheme<TextRenderDeps>): TextRenderDeps {
	// @ts-expect-error a text block's widgets draw in the editor's theme
	return deps;
}

export function cellRenderWithoutThemeRejected(deps: WithoutTheme<CellRenderDeps>): CellRenderDeps {
	// @ts-expect-error a table cell's widgets draw in the editor's theme
	return deps;
}

describe('the widget theme getter', () => {
	it('is passed explicitly by a text render built outside an editor', () => {
		const { deps } = makeRenderHarness(blockNode('x\n'), { theme: 'light' });
		expect(deps.getTheme()).toBe('light');
	});
});
