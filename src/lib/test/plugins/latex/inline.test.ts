// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { parseInline, computeInlineContent } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import {
	buildCoreInlineWidget,
	getInlineWidgetComponent,
	getInlineWidgetEditing,
	__resetInlineWidgetsForTests
} from '$lib/core/inline/inline-widgets';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import { registerMathInline, MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import {
	renderInlineMath,
	setMathRenderer,
	type MathRenderer
} from '$lib/plugins/latex/math-renderer';

function resetInlineState(): void {
	__resetInlineSyntaxForTests();
	__resetInlineWidgetsForTests();
	__clearDeclaredPluginInlineKindsForTests();
}

beforeEach(resetInlineState);
afterEach(resetInlineState);

const isMath = (n: InlineNode) => n.kind === MATH_INLINE;
const mathNodesIn = (raw: string) => parseInline(raw, 0, raw.length).filter(isMath);

// Recognition is gated on this extension registering the `$` trigger — with no
// extension loaded the scanner leaves `$` as literal text (bare-GFM parity).
describe('inline math is dormant until registered', () => {
	it('leaves $x$ as plain text with nothing registered', () => {
		expect(parseInline('$x$', 0, 3)).toEqual([{ kind: 'text', start: 0, end: 3, text: '$x$' }]);
	});
});

// The flanking rule (requirement 1) is the spec: open valid only when the char
// after `$` is neither whitespace nor a digit (currency-safe); close valid only
// when the char before `$` is not whitespace. The close is NOT digit-guarded, so
// `$x^2$` closes on a digit.
describe('$ flanking recognition', () => {
	beforeEach(() => registerMathInline());

	const cases: Array<[string, boolean]> = [
		['$x$', true],
		['$x^2$', true],
		['$ x$', false],
		['$x $', false],
		['$5', false],
		['$5 and $10', false],
		['a$b', false]
	];
	for (const [raw, recognized] of cases) {
		it(`${raw} → ${recognized ? 'math' : 'no math'}`, () => {
			expect(mathNodesIn(raw).length > 0).toBe(recognized);
		});
	}

	it('spans the full $…$ with start at the open $', () => {
		const [node] = mathNodesIn('a $x^2$ b');
		expect(node).toMatchObject({ start: 2, end: 7 });
	});
});

describe('inline math round-trip', () => {
	beforeEach(() => registerMathInline());

	it('serializes $x$ byte-for-byte', () => {
		expect(serialize(parse('$x$'))).toBe('$x$');
	});

	it('recognizes $x$ through the real parse path', () => {
		const paragraph = parse('$x$').children[0];
		const math = computeInlineContent(paragraph).filter(isMath);
		expect(math).toHaveLength(1);
		expect(math[0]).toMatchObject({ start: 0, end: 3 });
	});
});

// Post-migration mechanics: math renders through a `component`, so the descriptor
// carries no synchronous builder — the render layer's injected portal builder owns
// the atomic-island shell (asserted in the e2e). The shell-stamping unit tests moved
// with `buildMathWidget`'s deletion; the reveal-source policy and the dispatch
// contract are what stay unit-provable here.
describe('math widget dispatch', () => {
	beforeEach(() => registerMathInline());

	it('registers a component rather than a synchronous builder', () => {
		expect(getInlineWidgetComponent(MATH_INLINE as InlineNode['kind'])).toBeDefined();
	});

	it('a component kind builds nothing without a portal builder, and delegates to it verbatim', () => {
		const node = { kind: MATH_INLINE, start: 0, end: 3 } as InlineNode;
		// No portal builder → null (the render layer falls back to the raw span).
		expect(buildCoreInlineWidget(node, '$x$')).toBeNull();
		// With one → the dispatch returns its element untouched (the pool owns stamping).
		const portal = document.createElement('span');
		expect(buildCoreInlineWidget(node, '$x$', () => portal)).toBe(portal);
	});

	// reveal-source is the editing contract the widget-interaction layer reads to
	// swap the rendered math island for its editable source; pin its exact shape.
	it('registers the reveal-source editing policy', () => {
		expect(getInlineWidgetEditing(MATH_INLINE as InlineNode['kind'])).toEqual({
			revealSource: true
		});
	});
});

// The injected renderer is the plugin's consumer seam (latexPlugin({ renderer }) →
// setMathRenderer). The wired renderer must flow into the inline render MathInline
// reads, not a hardcoded engine — a regression to a fixed engine drops it.
describe('injected renderer threading', () => {
	const displayModes: boolean[] = [];
	const tagRenderer: MathRenderer = (source, { display }) => {
		displayModes.push(display);
		const dom = document.createElement('span');
		dom.className = 'tagged-math';
		dom.textContent = `tagged:${source}`;
		return { dom };
	};

	it('routes the injected renderer into the inline math render, in text mode', () => {
		setMathRenderer(tagRenderer);
		registerMathInline();
		// MathInline renders through renderInlineMath over the `$`-stripped interior;
		// the document-wide memo returns a clone of the renderer's node.
		const { dom } = renderInlineMath('x');
		expect(dom.className).toBe('tagged-math');
		expect(dom.textContent).toBe('tagged:x');
		// Inline `$…$` is text-mode math — a display:true regression would render
		// centered block math for every inline formula and no other test would catch it.
		expect(displayModes).toEqual([false]);
	});
});
