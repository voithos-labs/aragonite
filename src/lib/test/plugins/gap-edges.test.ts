// The bundled plugin kinds' `gapEdges` declarations, read through the eligibility door
// rather than off the descriptor: what a declaration is FOR is the boundary it opens, and a
// field assertion would survive the door forgetting to consult it. Deleting any bundled
// declaration reds a row here; the strip rows pin the tier that stays undeclared (#93).
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { resetPluginPlatformForTests } from '$lib/testing';
import { tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';
import { registerAdmonitions } from '$lib/plugins/admonitions/admonition-kind';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import { registerTocBlock } from '$lib/plugins/toc/toc-plugin';
import { gapEligibleAt } from '$lib/selection/gap-caret';

const TABLE = '| a | b |\n| - | - |\n';
const MATH_BLOCK = '$$\nx^2\n$$\n';
const MATH_FENCE = '```math\nx^2\n```\n';
const MERMAID = '```mermaid\ngraph TD\n```\n';
const CALLOUT = ':::note Title\nbody\n:::\n';
const DETAILS = '<details>\n<summary>S</summary>\n\nbody\n\n</details>\n';
const GENERIC_DIRECTIVE = ':::mystery\nbody\n:::\n';
const TOC = '[[toc]]\n';
const QUOTE = '> quoted\n';
const ALERT = '> [!NOTE]\n> alert body\n';

beforeEach(() => {
	resetPluginPlatformForTests();
	registerBuiltInBlocks();
	// One install teaches both math forms; admonitions co-registers githubAlert and
	// activates the directive grammar, which registers the generic container.
	registerMathBlock();
	registerMermaidKind();
	registerAdmonitions();
	registerDetailsKind();
	registerTocBlock();
});

/** The boundary between the two sources, with each parsed as its own top-level block. */
function eligibleBetween(above: string, below: string): boolean {
	const doc = parse(`${above}\n${below}`);
	expect(doc.children).toHaveLength(2);
	return gapEligibleAt(doc, [], 1);
}

describe('gapEdges declarations of the bundled plugin kinds', () => {
	// Without this the pairings below would all read "undeclared → false" and the true rows
	// would pass for the wrong reason.
	it('leaves the built-in table declaring both edges after the plugin installs', () => {
		expect(tryGetBlockKindDescriptor('table')?.gapEdges).toBe('both');
	});

	it('pins the fixture kinds the pairings assume', () => {
		expect(parse(MATH_BLOCK).children[0].kind).toBe('mathBlock');
		expect(parse(MATH_FENCE).children[0].kind).toBe('mathFence');
		expect(parse(MERMAID).children[0].kind).toBe('mermaid');
		expect(parse(CALLOUT).children[0].kind).toBe('admonition');
		expect(parse(DETAILS).children[0].kind).toBe('details');
		expect(parse(GENERIC_DIRECTIVE).children[0].kind).toBe('directiveContainer');
		expect(parse(QUOTE).children[0].kind).toBe('blockquote');
		expect(parse(ALERT).children[0].kind).toBe('githubAlert');
	});

	// Both orders, which is what separates 'both' from a single edge on each kind.
	it('opens the boundary between the two math forms in either order', () => {
		expect(eligibleBetween(MATH_BLOCK, MATH_FENCE)).toBe(true);
		expect(eligibleBetween(MATH_FENCE, MATH_BLOCK)).toBe(true);
	});

	// mermaid declares 'before' only: its focused Enter already grows a sibling below it,
	// so the decline is the declaration's other half, not an omission.
	it('opens the boundary above a mermaid diagram but not below it', () => {
		expect(eligibleBetween(TABLE, MERMAID)).toBe(true);
		expect(eligibleBetween(MERMAID, TABLE)).toBe(false);
	});

	// The toc is a render-primary leaf like the math forms, and its folded view leaves a caret
	// no textual landing at either edge. Miss-analysis: the declared set was pinned kind by
	// kind, so a kind that never declared had no row to red — an omission looked like a decision.
	it('opens the toc boundary against another trapped kind in either order', () => {
		expect(eligibleBetween(MATH_BLOCK, TOC)).toBe(true);
		expect(eligibleBetween(TOC, MATH_BLOCK)).toBe(true);
		expect(eligibleBetween(TOC, TOC)).toBe(true);
	});
});

describe('gapEdges on the opaque-container tier (#93)', () => {
	// Mixed pairs in both orders cover 'both' on each of the three kinds.
	it('opens the callout|details boundary in either order', () => {
		expect(eligibleBetween(CALLOUT, DETAILS)).toBe(true);
		expect(eligibleBetween(DETAILS, CALLOUT)).toBe(true);
	});

	it('opens the generic-directive boundary in either order', () => {
		expect(eligibleBetween(GENERIC_DIRECTIVE, CALLOUT)).toBe(true);
		expect(eligibleBetween(CALLOUT, GENERIC_DIRECTIVE)).toBe(true);
	});

	// Strip containers keep their unwrap/exit gestures instead — decided, not omitted.
	it('keeps blockquote, githubAlert, and list boundaries gap-free', () => {
		expect(eligibleBetween(QUOTE, QUOTE)).toBe(false);
		expect(eligibleBetween(ALERT, ALERT)).toBe(false);
		expect(eligibleBetween('- a\n', '1. b\n')).toBe(false);
	});

	it('keeps the boundary between two list items gap-free', () => {
		const doc = parse('- a\n- b\n');
		expect(doc.children).toHaveLength(1);
		expect(gapEligibleAt(doc, [0], 1)).toBe(false);
	});
});
