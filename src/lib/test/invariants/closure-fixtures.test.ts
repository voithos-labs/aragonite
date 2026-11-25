import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { ALL_BLOCK_KINDS, type AnyBlockKind, type CstNode } from '#lib/core/nodes.js';
import {
	getBlockKindDescriptor,
	tryGetBlockKindDescriptor
} from '#lib/schema/block-kind-descriptor.js';
import { activateDirectives } from '#lib/components/blocks/directive/activate-directives.js';
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF } from '#lib/core/directive/kinds.js';
import { registerMathBlock, MATH_BLOCK, MATH_FENCE } from '#lib/test/harness/registered-math.js';
import { registerMermaidKind, MERMAID } from '#lib/test/harness/registered-diagram.js';
import { registerDetailsPageWide, DETAILS } from '#lib/test/harness/registered-details.js';
import { registerAdmonitions } from '#packages/admonitions/src/admonition-kind.js';
import { ADMONITION } from '#packages/admonitions/src/kinds.js';
import { testView } from '#lib/test/harness/test-view.js';

// Every declared `sample` parses to a tree containing the kind that declared it
// (G1.24 rule c). Checked here rather than at registration, because a `parse` import there would
// close a schema → core/parser → schema cycle. It covers kinds that live in the library only.

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
	const fixture = descriptor!.samples?.[0];
	expect(fixture, `${kind} declares no sample`).toBeDefined();
	const doc = parse(fixture!);
	expect(
		treeContainsKind(doc, kind),
		`parse(${JSON.stringify(fixture)}) did not yield a "${kind}" node`
	).toBe(true);
}

describe('built-in conformance fixtures parse to their kind', () => {
	const withFixture = ALL_BLOCK_KINDS.filter(
		(kind) => getBlockKindDescriptor(kind).samples?.[0] !== undefined
	);

	it('is not vacuous: the parser-reachable built-ins carry fixtures', () => {
		expect(withFixture.length).toBeGreaterThan(8);
	});

	for (const kind of withFixture) {
		it(`${kind}`, () => checkFixture(kind));
	}

	it('leaves context-dependent and reserved kinds fixture-less', () => {
		expect(getBlockKindDescriptor('tableCell').samples?.[0]).toBeUndefined();
		expect(getBlockKindDescriptor('unrecognized').samples?.[0]).toBeUndefined();
	});
});

describe('directive + bundled-plugin conformance fixtures parse to their kind', () => {
	it('generic directive fallback (container + leaf)', () => {
		activateDirectives();
		checkFixture(DIRECTIVE_CONTAINER);
		checkFixture(DIRECTIVE_LEAF);
	});

	it('latex mathBlock', () => {
		registerMathBlock(testView());
		checkFixture(MATH_BLOCK);
	});

	it('latex mathFence (co-registered by registerMathBlock)', () => {
		registerMathBlock(testView());
		checkFixture(MATH_FENCE);
	});

	it('mermaid', () => {
		registerMermaidKind(testView());
		checkFixture(MERMAID);
	});

	it('details', () => {
		registerDetailsPageWide();
		checkFixture(DETAILS);
	});

	it('admonition', () => {
		activateDirectives();
		registerAdmonitions(testView());
		checkFixture(ADMONITION);
	});
});
