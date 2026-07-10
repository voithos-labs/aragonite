// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { parseInline, computeInlineContent } from '$lib/core/inline';
import type { InlineNode } from '$lib/core/nodes';
import { __resetInlineSyntaxForTests } from '$lib/core/inline/scan/plugin-syntax';
import {
	buildCoreInlineWidget,
	getInlineWidgetEditing,
	__resetInlineWidgetsForTests
} from '$lib/core/inline/inline-widgets';
import { __clearDeclaredPluginInlineKindsForTests } from '$lib/schema/plugin-kind';
import {
	registerMathInline,
	buildMathWidget,
	MATH_INLINE
} from '../../../routes/test/plugins/latex/latex-kind';
import type { MathRenderer } from '../../../routes/test/plugins/latex/math-renderer';

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

describe('math widget DOM', () => {
	beforeEach(() => registerMathInline());

	function expectWidgetShell(el: HTMLElement, start: number, end: number): void {
		expect(el.hasAttribute('data-inline-widget')).toBe(true);
		expect(el.getAttribute('contenteditable')).toBe('false');
		expect(el.dataset.sourceStart).toBe(String(start));
		expect(el.dataset.sourceEnd).toBe(String(end));
	}

	it('emits the atomic-widget shell and renders the delimiter-stripped source', () => {
		const fakeRender: MathRenderer = (source, { display }) => {
			const dom = document.createElement('span');
			dom.className = 'fake-math';
			dom.textContent = `${source}|${display}`;
			return { dom };
		};
		const node = { kind: MATH_INLINE, start: 2, end: 7 } as InlineNode;

		const el = buildMathWidget(node, 'a $x^2$ b', fakeRender);

		expectWidgetShell(el, 2, 7);
		// Inline math renders in text mode (display=false) over the `$`-stripped source.
		expect(el.querySelector('.fake-math')?.textContent).toBe('x^2|false');
	});

	it('produces a contract-compliant shell through the registered descriptor', () => {
		const node = { kind: MATH_INLINE, start: 0, end: 3 } as InlineNode;

		const el = buildCoreInlineWidget(node, '$x$');

		expect(el).not.toBeNull();
		expectWidgetShell(el as HTMLElement, 0, 3);
		expect((el as HTMLElement).childElementCount).toBeGreaterThan(0);
	});

	// reveal-source is the editing contract the widget-interaction layer reads to
	// swap the rendered math island for its editable source; pin its exact shape.
	it('registers the reveal-source editing policy', () => {
		expect(getInlineWidgetEditing(MATH_INLINE as InlineNode['kind'])).toEqual({
			revealSource: true
		});
	});
});

// The injectable renderer is the extension's consumer seam (latexPlugin({ renderer }));
// registerMathInline's param must flow into the registered widget's build closure, not
// a hardcoded engine — a regression to createMemoizedRenderer(katexRenderer) drops it.
describe('custom renderer threading', () => {
	const tagRenderer: MathRenderer = (source) => {
		const dom = document.createElement('span');
		dom.className = 'tagged-math';
		dom.textContent = `tagged:${source}`;
		return { dom };
	};

	it('routes a registered custom renderer into the widget the descriptor builds', () => {
		registerMathInline(tagRenderer);
		const node = { kind: MATH_INLINE, start: 0, end: 3 } as InlineNode;
		expect(buildCoreInlineWidget(node, '$x$')?.querySelector('.tagged-math')?.textContent).toBe(
			'tagged:x'
		);
	});
});
