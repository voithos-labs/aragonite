import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { registerAdmonitions } from '$lib/plugins/admonitions/admonition-kind';
import { registerDetailsKind } from '$lib/plugins/details/details-kind';
import { registerFootnoteDefinition } from '$lib/plugins/footnotes/footnote-definition';
import { registerMathBlock } from '$lib/plugins/latex/latex-kind';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';
import { getAllRegisteredKinds, getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { isBlockOpenerRegistered } from '$lib/schema/block-openers';
import { lineOpensAs } from '$lib/tree-operations/node-ops';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';

// The container kind gate elides a reparse when the rewritten opener line, read ALONE,
// still opens as the kind the node already is. That partition over every registered
// container is what makes the gate sound, and nothing else checks it: a new opener whose
// claim needs a later line must land in the conservative half here, loudly.

/**
 * Kinds whose opener declines a one-line probe, so the gate stays CONSERVATIVE for them
 * and every edit to their opener line pays the full container parse. Falling through is
 * the safe answer, so membership here is a cost, not a correctness problem.
 */
const CONSERVATIVE = new Set(['directiveContainer', 'admonition', 'details', 'note']);

beforeAll(() => {
	resetPluginPlatformForTests();
	registerAdmonitions();
	registerDetailsKind();
	registerFootnoteDefinition();
	registerMathBlock();
	registerMermaidKind();
	registerCalloutKind();
});

/** The first node of `kind` anywhere in the fixture's tree. */
function findKind(nodes: readonly CstNode[], kind: AnyBlockKind): CstNode | null {
	for (const node of nodes) {
		if (node.kind === kind) return node;
		const hit = findKind(node.children ?? [], kind);
		if (hit) return hit;
	}
	return null;
}

function firstLine(raw: string): string {
	const nl = raw.indexOf('\n');
	return nl < 0 ? raw : raw.slice(0, nl);
}

/** Every container kind the gate can reach, with its fixture's own first line. */
function eligibleContainers(): { kind: AnyBlockKind; node: CstNode }[] {
	const out: { kind: AnyBlockKind; node: CstNode }[] = [];
	for (const kind of getAllRegisteredKinds()) {
		const descriptor = getBlockKindDescriptor(kind);
		if (!descriptor.isContainer || !isBlockOpenerRegistered(kind)) continue;
		if (!descriptor.conformanceFixture) continue;
		const node = findKind(parse(descriptor.conformanceFixture).children, kind);
		if (node) out.push({ kind, node });
	}
	return out;
}

describe('opener verdict agreement across registered container kinds', () => {
	it('found the container kinds to partition', () => {
		expect(eligibleContainers().length).toBeGreaterThan(4);
	});

	it('every container either identifies itself from line 1 or is declared conservative', () => {
		const misfiled = eligibleContainers()
			.map(({ kind, node }) => ({
				kind,
				verdict: lineOpensAs(firstLine(node.raw), undefined),
				conservative: CONSERVATIVE.has(kind)
			}))
			.filter(({ kind, verdict, conservative }) => (verdict === kind) === conservative);

		expect(misfiled).toEqual([]);
	});

	// The load-bearing half: a regression here is a keystroke cost on the container-size axis.
	it.each(['blockquote', 'list', 'githubAlert', 'footnote-def'])(
		'%s identifies itself from its opener line',
		(kind) => {
			const found = eligibleContainers().find((c) => c.kind === kind);
			expect(found).toBeDefined();
			expect(lineOpensAs(firstLine(found!.node.raw), undefined)).toBe(kind);
		}
	);
});
