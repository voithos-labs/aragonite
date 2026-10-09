// @vitest-environment jsdom
// A click on a widget is the widget's to act on or the editor's to show the source for, never both
// and never neither, for every host gesture, mode and Ctrl state, with or without a claim.
// Miss-analysis: the editor's click check read the policy and the widget's check didn't, and no
// test mounted a widget through the editor's own pool to ask it under a plain-click host.
import { describe, it, expect } from 'vitest';
import { createSvelteWidgetPool } from '#lib/components/blocks/widget-portal.js';
import { createWidgetInteraction } from '#lib/components/blocks/text/widget-interaction.js';
import { registerInlineSyntax } from '#lib/core/inline/scan/plugin-syntax.js';
import { registerInlineWidgetKind } from '#lib/core/inline/inline-widgets.js';
import { declarePluginInlineKind } from '#lib/schema/plugin-kind.js';
import { bindActivationClick, type LinkClick } from '#lib/activation-click.js';
import { clickEndsHoldingRange } from '#lib/components/blocks/text/click-snap-guard.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import { ACTIVATION_CLICK_CASES } from '#lib/test/support/activation-click-cases.js';
import ActivationClickWidget from './fixtures/ActivationClickWidget.svelte';
import {
	installMathInline,
	mountWidgetBlock,
	widgetInteractionDeps
} from './text/math-widget-fixture';

installMathInline();

const SOURCE = 'one %%w%% two';

/** A `%%…%%` widget kind that shows its source on a click, and claims the activation click if asked. */
function registerClickWidget(claimsActivationClick: boolean): string {
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
		editing: { revealSource: true, claimsActivationClick }
	});
	return kind;
}

/** Whether the widget, mounted through the editor's pool in `mountMode`, acts on a click made in
 *  `mode`. */
function widgetActs(
	kind: string,
	linkClick: LinkClick,
	mode: PresentationMode,
	modified: boolean,
	detail = 1,
	mountMode: PresentationMode = mode
): boolean {
	let current = mountMode;
	const reading = fixtureReading({ mode: () => current });
	const pool = createSvelteWidgetPool({
		reportError: (error) => {
			throw error;
		},
		getTheme: () => 'light',
		getDocument: () => undefined,
		getContentVersion: () => 0,
		navigateTo: async () => false,
		reading,
		activationClick: bindActivationClick(reading.mode, () => linkClick, clickEndsHoldingRange)
	});
	const start = SOURCE.indexOf('%%');
	pool.beginPass();
	const wrapper = pool.acquire(kind as never, { kind, start, end: start + 5 } as never, '%%w%%');
	pool.sweep();
	current = mode;
	const widget = wrapper!.querySelector<HTMLElement>('.activation-click-widget')!;
	widget.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: modified, detail }));
	pool.dispose();
	return widget.dataset.acted !== undefined;
}

function mountInteraction(kind: string, linkClick: LinkClick, mode: PresentationMode) {
	const { el, node, widgets, inlineWidgets } = mountWidgetBlock(SOURCE, kind);
	widgets[0].getBoundingClientRect = () =>
		({ left: 10, right: 30, top: 0, bottom: 10, width: 20, height: 10, x: 10, y: 0 }) as DOMRect;
	const reading = fixtureReading({}, mode);
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				reading,
				activationClick: bindActivationClick(reading.mode, () => linkClick, clickEndsHoldingRange),
				setPendingCursor: () => {},
				setRevealing: () => {},
				isCrossBlock: () => false,
				getPendingClickPoint: () => null
			}
		)
	);
	return { el, interaction, inline: inlineWidgets[0] };
}

/** Whether the editor's click on the widget showed its source. */
async function editorShowsSource(
	kind: string,
	linkClick: LinkClick,
	mode: PresentationMode,
	modified: boolean,
	detail: number
): Promise<boolean> {
	const { interaction } = mountInteraction(kind, linkClick, mode);
	interaction.snapClickToWidgetEdge(20, 5, {
		click: { ctrlKey: modified, metaKey: false, detail },
		clickCount: detail
	});
	await settleEditor();
	return interaction.isRevealing();
}

describe('a click on a widget goes to exactly one of the widget and the editor', () => {
	for (const { name, linkClick, mode, modified, detail, follows } of ACTIVATION_CLICK_CASES) {
		for (const claims of [true, false]) {
			it(`${claims ? 'claiming' : 'plain'} widget, ${name}`, async () => {
				const kind = registerClickWidget(claims);
				const acts = claims && follows;

				expect(widgetActs(kind, linkClick, mode, modified, detail)).toBe(acts);
				// Reading mode shows no source at all, so there the widget alone answers.
				expect(await editorShowsSource(kind, linkClick, mode, modified, detail)).toBe(
					mode !== 'reading' && !acts
				);
			});
		}
	}
});

describe('a pooled widget', () => {
	it('answers in the mode of the click, not the mode it mounted in', () => {
		const kind = registerClickWidget(true);

		expect(widgetActs(kind, 'modifier', 'reading', false, 1, 'live')).toBe(true);
		expect(widgetActs(kind, 'modifier', 'live', false, 1, 'reading')).toBe(false);
	});
});

describe('a widget that follows on a plain click', () => {
	it('still shows its source to a caret arrowing in from an edge', async () => {
		const kind = registerClickWidget(true);
		const { el, interaction, inline } = mountInteraction(kind, 'plain', 'live');

		interaction.enterWidget(inline, true);
		await settleEditor();

		expect(interaction.isRevealing()).toBe(true);
		expect(el.childNodes[1].textContent).toBe('%%w%%');
	});
});
