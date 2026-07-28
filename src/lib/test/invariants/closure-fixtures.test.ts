import { describe, expect, it, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { ALL_BLOCK_KINDS, type AnyBlockKind, type CstNode } from '$lib/core/nodes';
import {
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor
} from '$lib/schema/block-kind-descriptor';
import { resetPluginPlatformForTests } from '$lib/testing';
import { activateDirectives } from '$lib/components/blocks/directive/activate-directives';
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF } from '$lib/core/directive/kinds';
import { registerMathBlock, MATH_BLOCK, MATH_FENCE } from '$lib/plugins/latex/latex-kind';
import { registerMermaidKind, MERMAID } from '$lib/plugins/mermaid/mermaid-kind';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';
import { registerAdmonitions } from '$lib/plugins/admonitions/admonition-kind';
import { ADMONITION } from '$lib/plugins/admonitions/kinds';
import { registerTocBlock, TOC_BLOCK } from '$lib/plugins/toc/toc-plugin';

// G1.24 rule (c): every declared `conformanceFixture` parses to a tree containing
// its declaring kind. Kept out of the flush seam — a `parse` import there would
// close a schema → core/parser → schema cycle — so it runs as this sweep. Scope:
// built-ins, the generic directive fallback, and the bundled plugins (src/lib/
// plugins). The routes/consumer fixtures (callout, memo, devprobe) carry the same
// field and are exercised by their own e2e, not this lib-resident sweep.

function treeContainsKind(
	node: { kind: string; children?: readonly CstNode[] },
	kind: string
): boolean {
	if (node.kind === kind) return true;
	return (node.children ?? []).some((child) => treeContainsKind(child, kind));
}

function checkFixture(kind: string): void {
	const descriptor = tryGetBlockKindDescriptor(kind as AnyBlockKind);
	expect(descriptor, `${kind} is not registered`).toBeDefined();
	const fixture = descriptor!.conformanceFixture;
	expect(fixture, `${kind} declares no conformanceFixture`).toBeDefined();
	const doc = parse(fixture!);
	expect(
		treeContainsKind(doc, kind),
		`parse(${JSON.stringify(fixture)}) did not yield a "${kind}" node`
	).toBe(true);
}

describe('built-in conformance fixtures parse to their kind', () => {
	const withFixture = ALL_BLOCK_KINDS.filter(
		(kind) => getBlockKindDescriptor(kind).conformanceFixture !== undefined
	);

	it('is not vacuous — the parser-reachable built-ins carry fixtures', () => {
		expect(withFixture.length).toBeGreaterThan(8);
	});

	for (const kind of withFixture) {
		it(`${kind}`, () => checkFixture(kind));
	}

	it('leaves context-dependent and reserved kinds fixture-less', () => {
		expect(getBlockKindDescriptor('tableCell').conformanceFixture).toBeUndefined();
		expect(getBlockKindDescriptor('unrecognized').conformanceFixture).toBeUndefined();
	});
});

describe('directive + bundled-plugin conformance fixtures parse to their kind', () => {
	beforeEach(() => resetPluginPlatformForTests());

	it('generic directive fallback (container + leaf)', () => {
		activateDirectives();
		checkFixture(DIRECTIVE_CONTAINER);
		checkFixture(DIRECTIVE_LEAF);
	});

	it('latex mathBlock', () => {
		registerMathBlock();
		checkFixture(MATH_BLOCK);
	});

	it('latex mathFence (co-registered by registerMathBlock)', () => {
		registerMathBlock();
		checkFixture(MATH_FENCE);
	});

	it('mermaid', () => {
		registerMermaidKind();
		checkFixture(MERMAID);
	});

	it('details', () => {
		registerDetailsKind();
		checkFixture(DETAILS);
	});

	it('admonition', () => {
		activateDirectives();
		registerAdmonitions();
		checkFixture(ADMONITION);
	});

	it('toc', () => {
		registerTocBlock();
		checkFixture(TOC_BLOCK);
	});
});
