// Miss-analysis: the round-trip property is a fixed-point oracle over a body the OPENER produced,
// so it can only draw bodies that already fit inside their fence — the edit path, where a body the
// block never parsed is written back into it, has no property at all. The container kit's
// terminator cell is the class's home and cannot reach this shape: it drives the last CHILD
// through `bodyWrite`, and this container has neither.
import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { getPluginMetadata, setPluginMetadata, type CstNode, type Document } from '$lib/core/nodes';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { describeConvergence } from '$lib/testing/parse-convergence';
import {
	registerMermaidKind,
	rebuildMermaidRaw,
	type MermaidMetadata
} from '$lib/plugins/mermaid/mermaid-kind';

/** The whole edit path: a shallow metadata merge, then the kind's rebuild. */
function commitCode(source: string, code: string): { node: CstNode; doc: Document } {
	const doc = parse(source);
	const node = doc.children[0];
	expect(node.kind).toBe('mermaid');
	const meta = getPluginMetadata<MermaidMetadata>(node);
	setPluginMetadata<MermaidMetadata>(node, { ...meta!, code });
	rebuildMermaidRaw(node);
	return { node, doc };
}

describe('a mermaid body carrying a fence run', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerMermaidKind();
	});

	it('grows the opener AND the closer past the run, so the block survives its next parse', () => {
		const { node, doc } = commitCode('```mermaid\ngraph TD\n```\n', 'graph TD\n```\nafter\n');
		expect(node.raw).toBe('````mermaid\ngraph TD\n```\nafter\n````\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(serialize(parse(node.raw))).toBe(node.raw);
	});

	// Marker-aware, not backtick-blind: a tilde fence is closed by tildes, so a backtick run in
	// the body is ordinary content and growing the fence would rewrite bytes for nothing.
	it('leaves a tilde fence alone around a backtick body', () => {
		const { node, doc } = commitCode('~~~mermaid\ngraph TD\n~~~\n', 'graph TD\n```\nafter\n');
		expect(node.raw).toBe('~~~mermaid\ngraph TD\n```\nafter\n~~~\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('escalates a tilde fence for a tilde run', () => {
		const { node, doc } = commitCode('~~~mermaid\ngraph TD\n~~~\n', 'graph TD\n~~~~\n');
		expect(node.raw).toBe('~~~~~mermaid\ngraph TD\n~~~~\n~~~~~\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	// An unterminated block has no closer line to grow, and the parser reads it to end of input
	// either way — minting one would invent bytes the author never wrote.
	it('grows the opener of an unterminated block and mints no closer', () => {
		const { node } = commitCode('```mermaid\ngraph TD\n', 'graph TD\n```\nafter\n');
		expect(node.raw).toBe('````mermaid\ngraph TD\n```\nafter\n');
	});

	it('keeps a closer already longer than the escalated opener, and its authored indent', () => {
		const { node } = commitCode('```mermaid\ngraph TD\n  `````  \n', 'graph TD\n```\n');
		expect(node.raw).toBe('````mermaid\ngraph TD\n```\n  `````  \n');
	});

	it('rewrites nothing when the body carries no run of its own', () => {
		const { node } = commitCode('```mermaid\ngraph TD\n```\n', 'graph LR\n');
		expect(node.raw).toBe('```mermaid\ngraph LR\n```\n');
	});

	it('carries the authored CRLF through an escalation', () => {
		const { node, doc } = commitCode('```mermaid\r\ngraph TD\r\n```\r\n', 'graph TD\r\n```\r\n');
		expect(node.raw).toBe('````mermaid\r\ngraph TD\r\n```\r\n````\r\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});
