// @vitest-environment jsdom
// `plainClickActivates`: a widget that acts on any click, as a link on a web page does, so the
// editable element never shows its source for a click; the caret still opens it from an edge.
// Miss-analysis: `claimsActivationClick` only ever stood down for the Ctrl/Cmd chord, so a host
// whose links should follow on a plain click had no policy to say so.
import { describe, it, expect, beforeEach } from 'vitest';
import { createWidgetInteraction } from '$lib/components/blocks/text/widget-interaction';
import { MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import {
	augmentInlineWidgetKind,
	widgetClaimsClick,
	type InlineWidgetEditingPolicy
} from '$lib/core/inline/inline-widgets';
import type { AnyInlineKind } from '$lib/core/nodes';
import { installMathInline, mountWidgetBlock, widgetInteractionDeps } from './math-widget-fixture';
import { settleEditor } from '$lib/test/harness/settle';

installMathInline();

// The math kind with the plain-click policy laid over its own, so the reveal machinery under test
// is the real one and only the click rule differs.
function plainClickMath(): void {
	augmentInlineWidgetKind(MATH_INLINE as AnyInlineKind, { plainClickActivates: true });
}

function mountClickBlock() {
	const { el, node, widgets, inlineWidgets } = mountWidgetBlock('one $a^1$ two', MATH_INLINE);
	widgets[0].getBoundingClientRect = () =>
		({ left: 10, right: 30, top: 0, bottom: 10, width: 20, height: 10, x: 10, y: 0 }) as DOMRect;
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				setPendingCursor: () => {},
				setRevealing: () => {},
				isCrossBlock: () => false,
				getPendingClickPoint: () => null
			}
		)
	);
	return { el, interaction, widget: inlineWidgets[0] };
}

describe('widgetClaimsClick', () => {
	const cases: [string, InlineWidgetEditingPolicy | undefined, boolean, boolean, boolean][] = [
		['no policy, plain click', undefined, false, false, false],
		['claims, plain click in live', { claimsActivationClick: true }, false, false, false],
		['claims, Ctrl-click in live', { claimsActivationClick: true }, true, false, true],
		['claims, plain click in reading', { claimsActivationClick: true }, false, true, true],
		['plain, plain click in live', { plainClickActivates: true }, false, false, true],
		['plain, Ctrl-click in live', { plainClickActivates: true }, true, false, true]
	];
	for (const [name, policy, modified, reading, claimed] of cases) {
		it(name, () => {
			expect(widgetClaimsClick(policy, modified, reading ? 'reading' : 'live')).toBe(claimed);
		});
	}
});

describe('a plain click on a plainClickActivates widget', () => {
	beforeEach(plainClickMath);

	it('leaves the widget mounted rather than showing its source', async () => {
		const b = mountClickBlock();

		b.interaction.snapClickToWidgetEdge(20, 5);
		await settleEditor();

		expect(b.interaction.isRevealing()).toBe(false);
		expect(b.el.querySelector('[data-inline-widget]')).not.toBeNull();
	});

	it('still opens its source when the caret enters from an edge', async () => {
		const b = mountClickBlock();

		b.interaction.enterWidget(b.widget, true);
		await settleEditor();

		expect(b.interaction.isRevealing()).toBe(true);
		expect(b.el.childNodes[1].textContent).toBe('$a^1$');
	});
});
