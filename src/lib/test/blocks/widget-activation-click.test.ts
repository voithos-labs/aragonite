// @vitest-environment jsdom
// A click on a widget is the widget's to act on or the editor's to show the source for, never both
// and never neither, for every editing policy, Ctrl state and presentation mode.
// Miss-analysis: the editor's click check read the policy and the widget's check didn't, and no
// test mounted a widget through the editor's own pool to ask it under the plain-click policy.
import { describe, it, expect } from 'vitest';
import { createSvelteWidgetPool } from '#lib/components/blocks/widget-portal.js';
import { createWidgetInteraction } from '#lib/components/blocks/text/widget-interaction.js';
import { registerInlineSyntax } from '#lib/core/inline/scan/plugin-syntax.js';
import {
	registerInlineWidgetKind,
	type InlineWidgetEditingPolicy
} from '#lib/core/inline/inline-widgets.js';
import { declarePluginInlineKind } from '#lib/schema/plugin-kind.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import ActivationClickWidget from './fixtures/ActivationClickWidget.svelte';
import {
	installMathInline,
	mountWidgetBlock,
	widgetInteractionDeps
} from './text/math-widget-fixture';

installMathInline();

const SOURCE = 'one %%w%% two';

/** A `%%…%%` widget kind that shows its source on a click, under `policy`'s click fields. */
function registerClickWidget(policy: InlineWidgetEditingPolicy): string {
	const kind = declarePluginInlineKind('activationClickWidget');
	registerInlineSyntax('%', (raw, pos, end) => {
		if (!raw.startsWith('%%', pos)) return null;
		const close = raw.indexOf('%%', pos + 2);
		if (close < 0 || close + 2 > end) return null;
		return { kind, start: pos, end: close + 2, children: [] };
	});
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		component: ActivationClickWidget,
		editing: { revealSource: true, ...policy }
	});
	return kind;
}

/** Whether the widget, mounted through the editor's pool, acts on the click. */
function widgetActs(kind: string, mode: PresentationMode, modified: boolean): boolean {
	const pool = createSvelteWidgetPool({
		reportError: (error) => {
			throw error;
		},
		getTheme: () => 'light',
		getDocument: () => undefined,
		getContentVersion: () => 0,
		navigateTo: async () => false,
		reading: fixtureReading({}, mode)
	});
	const start = SOURCE.indexOf('%%');
	pool.beginPass();
	const wrapper = pool.acquire(kind as never, { kind, start, end: start + 5 } as never, '%%w%%');
	pool.sweep();
	const widget = wrapper!.querySelector<HTMLElement>('.activation-click-widget')!;
	widget.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: modified }));
	pool.dispose();
	return widget.dataset.acted !== undefined;
}

/** Whether the editor's click on the widget showed its source. */
async function editorShowsSource(
	kind: string,
	mode: PresentationMode,
	modified: boolean
): Promise<boolean> {
	const { el, node, widgets } = mountWidgetBlock(SOURCE, kind);
	widgets[0].getBoundingClientRect = () =>
		({ left: 10, right: 30, top: 0, bottom: 10, width: 20, height: 10, x: 10, y: 0 }) as DOMRect;
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				reading: fixtureReading({}, mode),
				setPendingCursor: () => {},
				setRevealing: () => {},
				isCrossBlock: () => false,
				getPendingClickPoint: () => null
			}
		)
	);
	interaction.snapClickToWidgetEdge(20, 5, { modified });
	await settleEditor();
	return interaction.isRevealing();
}

const MODES: PresentationMode[] = ['source', 'preview-block', 'preview-inline', 'live', 'reading'];

// Which clicks the widget takes, by policy: none, the Ctrl/Cmd chord (any click in reading
// mode, which has no caret to place), or every click.
const POLICIES: [
	string,
	InlineWidgetEditingPolicy,
	(modified: boolean, reading: boolean) => boolean
][] = [
	['no claim', {}, () => false],
	['claimsActivationClick', { claimsActivationClick: true }, (m, r) => m || r],
	['plainClickActivates', { plainClickActivates: true }, () => true],
	['both fields', { claimsActivationClick: true, plainClickActivates: true }, () => true]
];

describe('a click on a widget goes to exactly one of the widget and the editor', () => {
	for (const [name, policy, takes] of POLICIES) {
		for (const mode of MODES) {
			for (const modified of [false, true]) {
				const click = modified ? 'Ctrl-click' : 'plain click';
				it(`${name}, ${click} in ${mode}`, async () => {
					const kind = registerClickWidget(policy);
					const acts = takes(modified, mode === 'reading');

					expect(widgetActs(kind, mode, modified)).toBe(acts);
					// Reading mode shows no source at all, so there the widget alone answers.
					const shows = mode !== 'reading' && !acts;
					expect(await editorShowsSource(kind, mode, modified)).toBe(shows);
				});
			}
		}
	}
});
