import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations/node-ops';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { registerMathFence, MATH_FENCE } from '$lib/plugins/latex/latex-kind';
import { registerMermaidKind, MERMAID } from '$lib/plugins/mermaid/mermaid-kind';
import { describeConvergence } from '$lib/test/harness/parse-converged';

// GH #180 at the plugin surface: the class is the grammar's, not a kind list, so a fence a plugin
// opener claims owes the same terminator the built-in one does. Both bundled fence kinds are here
// because they take opposite unterminated readings — mermaid claims an open fence, mathFence
// declines it to `fencedCode` — and the swallowed document is the same either way.
// Miss-analysis: the kind-change absorb's pins drew prose demotions only, and the plugins e2e
// project sits outside tree-ops' commit-tier gate, so nothing typed a fence opener over content.

describe('a typed plugin fence closes over an empty body (GH #180)', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerMermaidKind();
		registerMathFence();
	});

	it('```mermaid leaves one diagram and the neighbours standing', () => {
		const doc = parse('x\n\nalpha beta\n\ngamma delta\n');

		updateNodeContent(doc, 0, '```mermaid\n');

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			[MERMAID, '```mermaid\n```\n'],
			['paragraph', 'alpha beta\n'],
			['paragraph', 'gamma delta\n']
		]);
		expect(serialize(doc)).toBe('```mermaid\n```\n\nalpha beta\n\ngamma delta\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('```mermaid holds against a tight follower', () => {
		const doc = parse('# h\ntail\n');

		updateNodeContent(doc, 0, '```mermaid\n');

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			[MERMAID, '```mermaid\n```\n'],
			['paragraph', 'tail\n']
		]);
		expect(describeConvergence(doc)).toBeNull();
	});

	// The terminator is what makes the plugin's own opener claim the bytes at all: unterminated,
	// they fall through to `fencedCode` and eat the document.
	it('```math becomes a math fence rather than swallowing the rest', () => {
		const doc = parse('x\n\nalpha beta\n\ngamma delta\n');

		updateNodeContent(doc, 0, '```math\n');

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			[MATH_FENCE, '```math\n```\n'],
			['paragraph', 'alpha beta\n'],
			['paragraph', 'gamma delta\n']
		]);
		expect(describeConvergence(doc)).toBeNull();
	});

	it('```math holds against a tight follower', () => {
		const doc = parse('# h\ntail\n');

		updateNodeContent(doc, 0, '```math\n');

		expect(doc.children.map((c) => [c.kind, c.raw])).toEqual([
			[MATH_FENCE, '```math\n```\n'],
			['paragraph', 'tail\n']
		]);
		expect(describeConvergence(doc)).toBeNull();
	});
});
