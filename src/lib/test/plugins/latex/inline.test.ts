// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { installPlugins, parse, serialize, parseInline, type CstNode, type InlineNode } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { computeInlineContent } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	buildCoreInlineWidget,
	getInlineWidgetComponent,
	getInlineWidgetEditing
} from '$lib/core/inline/inline-widgets';
import { registerMathInline, MATH_INLINE } from '$lib/plugins/latex/latex-kind';
import {
	renderInlineMath,
	setMathRenderer,
	type MathRenderer
} from '$lib/plugins/latex/math-renderer';

beforeEach(resetPluginPlatformForTests);
afterEach(resetPluginPlatformForTests);

const isMath = (n: InlineNode) => n.kind === MATH_INLINE;
const mathNodesIn = (raw: string) => parseInline(raw, 0, raw.length).filter(isMath);

// Recognition starts only once the plugin registers the `$` trigger: without it the scanner
// leaves `$` as literal text, exactly as plain GFM does.
describe('inline math is dormant until registered', () => {
	it('leaves $x$ as plain text with nothing registered', () => {
		expect(parseInline('$x$', 0, 3)).toEqual([{ kind: 'text', start: 0, end: 3, text: '$x$' }]);
	});
});

// The spec: open valid when the char after `$` is not whitespace; close valid when the char
// before it is not whitespace and the char after it is not a digit; and a span that is purely a
// number is a price, not a formula. Miss-analysis: the table paired a letter opener with a digit
// closer (`$x^2$`) and a digit opener with no closer (`$5`, `$5 and $10`), never a digit opener
// with a valid closer, which is the one case the first-byte check got wrong.
describe('$ flanking recognition', () => {
	beforeEach(() => registerMathInline());

	const cases: Array<[string, boolean]> = [
		['$x$', true],
		['$x^2$', true],
		['$10^5$', true],
		['$3x$', true],
		['$5-2$', true],
		['$ x$', false],
		['$x $', false],
		['$5', false],
		['$5 and $10', false],
		// A span that is only a number is money; the range needs the closer's digit guard.
		['$5$', false],
		['$1,000$', false],
		['$5.00$', false],
		['$10-$20', false],
		['$x$5', false],
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

/**
 * The table above reads a count, which cannot tell `$x$` from a match that swallowed the prose
 * in front of it. These read the span itself, over the shapes where a price stands ahead of a
 * formula. Miss-analysis: no case ever put two `$` runs in one line with prose between them, so
 * where a match ends, the one reading that mattered, was never asserted at all.
 */
describe('a claim ends at the first later $, or not at all', () => {
	beforeEach(() => registerMathInline());

	const spansOf = (raw: string) => mathNodesIn(raw).map((n) => [n.start, n.end]);

	const claims: Array<[string, number[][]]> = [
		['It costs $5 and the ratio is $x$.', [[29, 32]]],
		['We paid $20 for $n$ shards.', [[16, 19]]],
		['Budget $5, formula $x^2$ here.', [[19, 24]]],
		['$5 and $10, plus $x$', [[17, 20]]],
		['costs $9 and $x$', [[13, 16]]],
		// The closer's digit guard declines at `$x$`; the retry from the next `$` must not then
		// reach across the prose to `$y$`'s closer.
		['$x$5 and $y$', [[9, 12]]],
		// A space before a `$` ends the attempt where it stands: `$a` stays literal.
		['$a $b$', [[3, 6]]]
	];
	for (const [raw, spans] of claims) {
		it(`${raw} → ${JSON.stringify(spans)}`, () => {
			expect(spansOf(raw)).toEqual(spans);
		});
	}
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

// The report behind #319 looked like a container defect. It is not: a directive's prose reaches
// the same recognizer a top-level paragraph does, so both give the same answer.
describe('a directive container reaches the same recognizer', () => {
	beforeEach(() => {
		installPlugins([admonitionsPlugin()]);
		registerMathInline();
	});

	const PROSE = 'One part in $10^5$ here.\n';
	const mathIn = (node: CstNode) => computeInlineContent(node).filter(isMath);

	it('answers for a `:::tip` body exactly as for a top-level paragraph', () => {
		const body = parse(`:::tip Measure\n${PROSE}:::\n`).children[0].children?.[1];
		expect(body?.kind).toBe('paragraph');
		const inDirective = mathIn(body!);
		expect(inDirective).toEqual(mathIn(parse(PROSE).children[0]));
		expect(inDirective).toHaveLength(1);
	});
});

// Math renders through a `component`, so the descriptor has no synchronous builder and the
// render layer builds the wrapper span (asserted in the e2e). What a unit test can still
// prove is the reveal-source policy and how the dispatch behaves.
describe('math widget dispatch', () => {
	beforeEach(() => registerMathInline());

	it('registers a component rather than a synchronous builder', () => {
		expect(getInlineWidgetComponent(MATH_INLINE as InlineNode['kind'])).toBeDefined();
	});

	it('a component kind builds nothing without a portal builder, and delegates to it verbatim', () => {
		const node = { kind: MATH_INLINE, start: 0, end: 3 } as InlineNode;
		// No portal builder → null (the render layer falls back to the raw span).
		expect(buildCoreInlineWidget(node, '$x$')).toBeNull();
		// With one, the dispatch returns its element untouched; the render layer adds the
		// attributes.
		const portal = document.createElement('span');
		expect(buildCoreInlineWidget(node, '$x$', () => portal)).toBe(portal);
	});

	// `revealSource` is what the widget-interaction code reads to swap the rendered math
	// for its editable source; its exact shape is pinned here.
	it('registers the reveal-source editing policy', () => {
		const policy = getInlineWidgetEditing(MATH_INLINE as InlineNode['kind']);
		expect(policy?.revealSource).toBe(true);
		expect(Object.keys(policy ?? {}).sort()).toEqual([
			'revealContentSpan',
			'revealOffsetAtPoint',
			'revealSource'
		]);
	});

	// The span bounds a caret entering the source, and is where a click the glyph measurement
	// cannot answer for goes; either way the caret stays inside the `$` delimiters.
	it('reports its content span inside the `$` delimiters', () => {
		const span = getInlineWidgetEditing(MATH_INLINE as InlineNode['kind'])?.revealContentSpan;
		expect(span?.('$x^2$')).toEqual({ start: 1, end: 4 });
		expect(span?.('$a$')).toEqual({ start: 1, end: 2 });
		// Too short to hold delimiters plus content: no span rather than a nonsense one.
		expect(span?.('$')).toBeNull();
	});
});

// The renderer is what a consumer supplies (`latexPlugin({ renderer })` calls
// `setMathRenderer`). It has to reach the inline render MathInline reads, rather than a
// hardcoded one, which a regression to a fixed renderer would drop.
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
		// the document-wide cache returns a clone of the renderer's node.
		const { dom } = renderInlineMath('x');
		expect(dom.className).toBe('tagged-math');
		expect(dom.textContent).toBe('tagged:x');
		// Inline `$…$` is text-mode math: passing `display: true` would render centered
		// block math for every inline formula, and no other test would catch it.
		expect(displayModes).toEqual([false]);
	});
});
