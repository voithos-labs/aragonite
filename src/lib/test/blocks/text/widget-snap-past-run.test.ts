// @vitest-environment jsdom
// A click past a run of widgets lands after the run, wherever the browser parked its text caret.
// Miss-analysis: the snap kept any caret in text, and only Chromium ran the click rows; real Firefox
// parks a click past the run in the text before it.
import { beforeAll, describe, it, expect } from 'vitest';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import { createWidgetInteraction } from '#lib/components/blocks/text/widget-interaction.js';
import { MATH_INLINE } from '#packages/latex/src/latex-kind.js';
import { installMathInline, mountWidgetBlock, widgetInteractionDeps } from './math-widget-fixture';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';

installMathInline();
beforeAll(installLayoutStubs);

// `end $a$$b$ x`: text [0, 4), widgets [4, 7) and [7, 10), text [10, 12), the widgets drawn flush.
function mountRun() {
	const { el, node, widgets } = mountWidgetBlock('end $a$$b$ x', MATH_INLINE);
	widgets.forEach((widget, i) => {
		const left = 40 + 20 * i;
		widget.getBoundingClientRect = () =>
			({
				left,
				right: left + 20,
				top: 0,
				bottom: 10,
				width: 20,
				height: 10,
				x: left,
				y: 0
			}) as DOMRect;
	});
	const snapped: number[] = [];
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				caretWriter: testCaretWriter,
				cursor: { setRaw: (offset: number) => snapped.push(offset) },
				setSnapTarget: () => {},
				isCrossBlock: () => false,
				getPendingClickPoint: () => null
			}
		)
	);
	return { el, interaction, snapped };
}

function caretInText(text: Node, offset: number): void {
	window.getSelection()!.collapse(text, offset);
}

describe('a click beside a run of widgets', () => {
	it('moves a text caret the browser parked before the run to the run’s far edge', () => {
		const b = mountRun();
		caretInText(b.el.firstChild!, 4);
		b.interaction.notePress({ clientX: 84, clientY: 5, button: 0 });
		b.interaction.snapClickToWidgetEdge({});
		expect(b.snapped).toEqual([10]);
	});

	it('leaves a text caret already at the edge the click is nearest', () => {
		const b = mountRun();
		caretInText(b.el.lastChild!, 0);
		b.interaction.notePress({ clientX: 84, clientY: 5, button: 0 });
		b.interaction.snapClickToWidgetEdge({});
		expect(b.snapped).toEqual([]);
	});

	// Miss-analysis: both rows clicked on the run's own line, so none saw a click on the line below
	// reach back up to the run.
	it('leaves a text caret clicked on a line the run isn’t on', () => {
		const b = mountRun();
		caretInText(b.el.firstChild!, 0);
		b.interaction.notePress({ clientX: 84, clientY: 25, button: 0 });
		b.interaction.snapClickToWidgetEdge({});
		expect(b.snapped).toEqual([]);
	});
});
