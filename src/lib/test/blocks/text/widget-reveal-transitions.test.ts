// @vitest-environment jsdom
//
// G1.26 fired through the real machinery: the settle-window re-entry through the
// interaction factory's public surface, the source-length precondition through
// the reveal kernel — and the legal reveal→commit / reveal→cancel cycles pinned
// silent, because a false-firing invariant poisons the channel every e2e spec
// watches.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../../dev-warn';
import { createWidgetInteraction } from '$lib/components/blocks/text/widget-interaction';
import { createSourceReveal } from '$lib/cursor/reveal-source';
import { registerMathInline, MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { resetInlineState, mountWidgetBlock, widgetInteractionDeps } from './math-widget-fixture';

beforeEach(() => {
	vi.stubEnv('DEV', true);
	vi.mocked(devWarn).mockClear();
	resetInlineState();
	registerMathInline();
});

afterEach(() => {
	document.body.innerHTML = '';
	resetInlineState();
	vi.unstubAllEnvs();
});

function revealFires(): unknown[][] {
	return vi.mocked(devWarn).mock.calls.filter(([tag]) => tag === 'invariant:reveal-transition');
}

// A paragraph whose math widget sits at the leading edge, so enterEdgeWidget
// ('start') — the cross-block edge landing — opens its reveal.
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

const settle = () => new Promise((r) => setTimeout(r));

describe('reveal transitions — settle-window re-entry (G1.26)', () => {
	it('a second entry landing synchronously inside the settle window fires', async () => {
		const { interaction } = mountEdgeMathBlock();
		// First entry opens the reveal; its settle window spans the microtask chain,
		// so a synchronous second entry lands inside it — the interleaving no real
		// gesture (a macrotask) can produce.
		interaction.enterEdgeWidget('start');
		interaction.enterEdgeWidget('start');
		await settle();

		expect(revealFires()).toHaveLength(1);
		expect(revealFires()[0][2]).toBe('start-during-settle');
	});

	it('a full reveal → Enter-commit cycle stays silent', async () => {
		const { interaction } = mountEdgeMathBlock();
		interaction.enterEdgeWidget('start');
		await settle();
		expect(interaction.isRevealing()).toBe(true);

		await interaction.handleRevealingKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

		expect(interaction.isRevealing()).toBe(false);
		expect(devWarn).not.toHaveBeenCalled();
	});

	it('a full reveal → Escape-cancel cycle stays silent', async () => {
		const { interaction } = mountEdgeMathBlock();
		interaction.enterEdgeWidget('start');
		await settle();

		await interaction.handleRevealingKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

		expect(interaction.isRevealing()).toBe(false);
		expect(devWarn).not.toHaveBeenCalled();
	});
});

describe('reveal transitions — kernel source-length precondition (G1.26)', () => {
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
			getAmbientLength: () => 0,
			isRevealed: () => false,
			showSource: () => {},
			showRendered: () => {}
		});

		await reveal.reveal();

		expect(revealFires()).toHaveLength(1);
		expect(revealFires()[0][2]).toEqual({ sourceLength: 3, sourceStart: 2, sourceEnd: 7 });
	});
});
