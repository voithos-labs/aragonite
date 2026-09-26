// @vitest-environment jsdom
//
// G1.26 fired through the real code: re-entering during the settle window through the public
// interaction factory, and the source-length precondition through the primitive that swaps the
// DOM. The legal show-then-commit and show-then-cancel cycles are also covered as silent,
// because an invariant that fires wrongly floods the console every e2e spec watches.
import { describe, it, expect } from 'vitest';

import { takeDevWarns } from '$lib/test/support/warn-gate';
import { createWidgetInteraction } from '$lib/components/blocks/text/widget-interaction';
import { createSourceReveal } from '$lib/cursor/reveal-source';
import { MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { installMathInline, mountWidgetBlock, widgetInteractionDeps } from './math-widget-fixture';
import { settleEditor } from '$lib/test/harness/settle';

installMathInline();

const REVEAL_TRANSITION = ['invariant:reveal-transition'];

// A paragraph whose math widget sits at the leading edge, so enterEdgeWidget
// ('start'), the arrival from another block, shows its source.
function mountEdgeMathBlock() {
	const { el, node } = mountWidgetBlock('$x^2$ tail', MATH_INLINE);
	const interaction = createWidgetInteraction(
		widgetInteractionDeps(
			{ node, el },
			{
				blockEdit: { updateBlockContent: () => {} },
				setPendingCursor: () => {},
				setRevealing: () => {},
				isCrossBlock: () => false
			}
		)
	);
	return { interaction };
}

describe('reveal transitions: settle-window re-entry (G1.26)', () => {
	it('a second entry landing synchronously inside the settle window fires', async () => {
		const { interaction } = mountEdgeMathBlock();
		// The first entry shows the source; its settle window spans the microtask chain, so a
		// synchronous second entry lands inside it, an ordering no real gesture can produce.
		interaction.enterEdgeWidget('start');
		interaction.enterEdgeWidget('start');
		await settleEditor();

		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(REVEAL_TRANSITION);
		expect(fires[0].details).toBe('start-during-settle');
	});

	it('a full reveal → fold-commit cycle stays silent', async () => {
		const { interaction } = mountEdgeMathBlock();
		interaction.enterEdgeWidget('start');
		await settleEditor();
		expect(interaction.isRevealing()).toBe(true);

		interaction.foldRevealBeforeMutation();

		expect(interaction.isRevealing()).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});

	it('a full reveal → Escape-cancel cycle stays silent', async () => {
		const { interaction } = mountEdgeMathBlock();
		interaction.enterEdgeWidget('start');
		await settleEditor();

		await interaction.handleRevealingKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

		expect(interaction.isRevealing()).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});
});

describe('reveal transitions: the shared core source-length precondition (G1.26)', () => {
	it('a source not spanning its [sourceStart, sourceEnd) range fires at reveal entry', async () => {
		const reveal = createSourceReveal({
			get container() {
				return null;
			},
			get sourceStart() {
				return 2;
			},
			get sourceEnd() {
				return 7;
			},
			get source() {
				return '$x$'; // length 3 ≠ 5
			},
			isRevealed: () => false,
			showSource: () => {},
			showRendered: () => {}
		});

		await reveal.reveal();

		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(REVEAL_TRANSITION);
		expect(fires[0].details).toEqual({ sourceLength: 3, sourceStart: 2, sourceEnd: 7 });
	});
});
