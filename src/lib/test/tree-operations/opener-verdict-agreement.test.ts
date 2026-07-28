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

// The container kind gate skips a reparse when the rewritten opener line, read
// ALONE, still opens as the kind the node already is. That is a claim about every
// registered container: either its first line identifies it on its own (the gate can
// elide its content edits) or it does not (the gate falls through to the full parse
// for it, always). This partition is what makes the gate sound, and nothing else
// checks it — so a new opener whose claim needs a later line lands in the
// conservative half here, loudly, instead of silently eliding a real kind change.

/**
 * Kinds whose opener declines a one-line probe, so the gate is CONSERVATIVE for
 * them — every edit to their opener line pays the full container parse.
 *
 * `directiveContainer` and `admonition` need their `:::` closer before the opener
 * claims anything; `details` needs its `</details>`, and a bare `<details>` reads as
 * an HTML block. None is a correctness problem: falling through is the safe answer.
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

	// The load-bearing half: these are the kinds whose ordinary typing the gate
	// elides, so a regression here is a keystroke cost on the container-size axis.
	it.each(['blockquote', 'list', 'githubAlert', 'footnote-def'])(
		'%s identifies itself from its opener line',
		(kind) => {
			const found = eligibleContainers().find((c) => c.kind === kind);
			expect(found).toBeDefined();
			expect(lineOpensAs(firstLine(found!.node.raw), undefined)).toBe(kind);
		}
	);
});
