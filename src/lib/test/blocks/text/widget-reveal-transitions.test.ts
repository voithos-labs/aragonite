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
import {
	createWidgetInteraction,
	type WidgetInteractionDeps
} from '$lib/components/blocks/text/widget-interaction';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { createSourceReveal } from '$lib/cursor/reveal-source';
import { parse } from '$lib/core/parser';
import { computeInlineContent } from '$lib/core/inline';
import { trimTrailingLineEnding } from '$lib/core/lines';
import { rawTextOfNode } from '$lib/cursor/widget-offset';
import type { CstNode, InlineNode } from '$lib/core/nodes';
import { registerMathInline, MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import { stampMathWidget, resetInlineState } from './math-widget-fixture';

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
	const node: CstNode = parse('$x^2$ tail').children[0];
	const math = computeInlineContent(node).find((n: InlineNode) => n.kind === MATH_INLINE)!;
	const display = trimTrailingLineEnding(node.raw);

	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.append(stampMathWidget(math), document.createTextNode(display.slice(math.end)));
	document.body.appendChild(el);
	el.focus();

	const widgetSelection = createWidgetSelectionState({ onSelect: () => {} });
	const deps = {
		get node() {
			return node;
		},
		get index() {
			return 0;
		},
		get myPath() {
			return [0];
		},
		getEl: () => el,
		getAmbientLength: () => 0,
		getEditorContentWidth: () => 800,
		widgetSelection,
		blockEdit: { updateBlockContent: () => {} },
		getSnapTarget: () => null,
		setSnapTarget: () => {},
		setPendingCursor: () => {},
		readRawText: () =>
			Array.from(el.childNodes).reduce((acc, child) => acc + rawTextOfNode(child, node.raw), ''),
		setRevealing: () => {},
		isCrossBlock: () => false,
		get linkRef() {
			return undefined;
		}
	} as unknown as WidgetInteractionDeps;

	return { interaction: createWidgetInteraction(deps) };
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
