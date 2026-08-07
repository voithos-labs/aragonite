// The bundled plugin kinds' `gapEdges` declarations, read through the eligibility door
// rather than off the descriptor: what a declaration is FOR is the boundary it opens, and a
// field assertion would survive the door forgetting to consult it. Deleting any of the three
// declarations reds a row here.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { registerBuiltInBlocks } from '$lib/components/built-in-blocks';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';
import { gapEligibleAt } from '$lib/selection/gap-caret';

const TABLE = '| a | b |\n| - | - |\n';
const MATH_BLOCK = '$$\nx^2\n$$\n';
const MATH_FENCE = '```math\nx^2\n```\n';
const MERMAID = '```mermaid\ngraph TD\n```\n';

beforeEach(() => {
	__resetSchemaRegistriesForTests();
	registerBuiltInBlocks();
	// One install teaches both math forms; mermaid is its own registrar.
	registerMathBlock();
	registerMermaidKind();
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
});
