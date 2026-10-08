import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib';
import { registerAdmonitions } from '#lib/plugins/admonitions/admonition-kind.js';
import { registerDetailsKind } from '#lib/plugins/details/details-kind.js';
import { registerFootnoteDefinition } from '#lib/plugins/footnotes/footnote-definition.js';
import { registerMathBlock } from '#lib/plugins/latex/latex-kind.js';
import { registerMermaidKind } from '#lib/plugins/mermaid/mermaid-kind.js';
import {
	getAllRegisteredKinds,
	getBlockKindDescriptor
} from '#lib/schema/block-kind-descriptor.js';
import { isBlockOpenerRegistered, defaultGrammarView } from '#lib/schema/block-openers.js';
import { lineOpensAs } from '#lib/schema/container-raw.js';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import type { AnyBlockKind, CstNode } from '#lib/core/nodes.js';

// The container kind check skips a reparse when the rewritten opener line, read alone,
// still opens as the kind the node already is. That partition over every registered
// container is what makes the check sound, and nothing else checks it: a new opener that
// needs a later line to decide must land in the conservative half here, loudly.

/**
 * Kinds whose opener declines a one-line trial parse, so every edit to their opener line pays the
 * full container parse: a cost, not a correctness problem.
 */
const CONSERVATIVE = new Set(['directiveContainer', 'admonition', 'details', 'callout']);

beforeEach(() => {
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

/** Every container kind the check can reach, with its fixture's own first line. */
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
				verdict: lineOpensAs(firstLine(node.raw), defaultGrammarView),
				conservative: CONSERVATIVE.has(kind)
			}))
			.filter(({ kind, verdict, conservative }) => (verdict === kind) === conservative);

		expect(misfiled).toEqual([]);
	});

	// The half that matters: a regression here is a keystroke cost on the container-size axis.
	it.each(['blockquote', 'list', 'githubAlert', 'footnote-def'])(
		'%s identifies itself from its opener line',
		(kind) => {
			const found = eligibleContainers().find((c) => c.kind === kind);
			expect(found).toBeDefined();
			expect(lineOpensAs(firstLine(found!.node.raw), defaultGrammarView)).toBe(kind);
		}
	);
});
