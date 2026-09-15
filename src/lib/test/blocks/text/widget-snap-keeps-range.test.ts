// @vitest-environment jsdom
//
// The widget edge-snap seats a CARET, so it stands down for a selection the surface already
// paints. Miss-analysis: every snap test seated from a collapsed caret, and the guard read the
// start container's node type, so no test ever called the snap over a painted range.
import { describe, it, expect } from 'vitest';
import { createWidgetInteraction } from '$lib/components/blocks/text/widget-interaction';
import { MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { installMathInline, mountWidgetBlock, widgetInteractionDeps } from './math-widget-fixture';

installMathInline();

// "one $a^1$ two" with a real box on the widget, so a click to its right reaches the snap.
function mountSnapBlock() {
	const { el, node, widgets } = mountWidgetBlock('one $a^1$ two', MATH_INLINE);
	widgets[0].getBoundingClientRect = () =>
		({ left: 10, right: 30, top: 0, bottom: 10, width: 20, height: 10, x: 10, y: 0 }) as DOMRect;
	const snapped: number[] = [];
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				cursor: {
					setRaw: (offset: number) => {
						snapped.push(offset);
						window.getSelection()?.removeAllRanges();
					}
				},
				setSnapTarget: () => {},
				isCrossBlock: () => false,
				getPendingClickPoint: () => null
			}
		)
	);
	return { el, interaction, snapped };
}

function paintWholeSurface(el: HTMLElement): void {
	const range = document.createRange();
	range.selectNodeContents(el);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
}

describe('widget edge-snap over a painted range', () => {
	it('leaves the whole-surface range a triple-click painted', () => {
		const b = mountSnapBlock();
		paintWholeSurface(b.el);

		b.interaction.snapClickToWidgetEdge(50, 5);

		expect(b.snapped).toEqual([]);
		expect(window.getSelection()?.isCollapsed).toBe(false);
		expect(window.getSelection()?.getRangeAt(0).toString()).toBe(b.el.textContent);
	});

	it('still snaps a collapsed caret that sits on no glyph', () => {
		const b = mountSnapBlock();
		const range = document.createRange();
		range.setStart(b.el, 1);
		range.collapse(true);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);

		b.interaction.snapClickToWidgetEdge(50, 5);

		expect(b.snapped).toEqual([9]);
	});
});
