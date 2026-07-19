import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { getPluginMetadata, setPluginMetadata, type CstNode } from '$lib/core/nodes';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import {
	registerMermaidKind,
	rebuildMermaidRaw,
	type MermaidMetadata
} from '$lib/plugins/mermaid/mermaid-kind';

// The rebuild-inverse guard: the byte round-trip alone passes even if the opener
// mis-captured metadata (the opaque contract serializes `raw` verbatim), so these
// pin that `rebuildMermaidRaw` reproduces the exact bytes from metadata — the
// path every `updateOwnMetadata` code commit rides.

function parseMermaid(src: string): CstNode {
	const block = parse(src).children[0];
	expect(block.kind).toBe('mermaid');
	return block;
}

// The editor's metadata commit is a shallow merge over the existing record.
function patchCode(node: CstNode, code: string): void {
	const meta = getPluginMetadata<MermaidMetadata>(node);
	setPluginMetadata<MermaidMetadata>(node, { ...meta!, code });
}

describe('mermaid metadata → rebuildRaw fidelity', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerMermaidKind();
	});

	it('captures the code and fence shape in metadata', () => {
		const node = parseMermaid('```mermaid theme=dark\ngraph TD\n\tA --> B\n```\n');
		const meta = getPluginMetadata<MermaidMetadata>(node);
		expect(meta?.code).toBe('graph TD\n\tA --> B\n');
		expect(meta?.fenceChar).toBe('`');
		expect(meta?.fenceLength).toBe(3);
		expect(meta?.infoRaw).toBe('mermaid theme=dark');
		expect(meta?.closerRaw).toBe('```\n');
	});

	const rebuildInverse: Array<[label: string, src: string]> = [
		['a plain fence', '```mermaid\ngraph TD\n```\n'],
		['a CRLF fence', '```mermaid\r\ngraph TD\r\n```\r\n'],
		['a ~~~ fence with a longer closer', '~~~mermaid\ngraph TD\n~~~~~\n'],
		['an indented fence', '  ```mermaid\ngraph TD\n ```\n'],
		['an unterminated fence at EOF', '```mermaid\ngraph TD'],
		['an empty code body', '```mermaid\n```\n'],
		['unicode code', '```mermaid\ngraph TD\n\t日本語 --> 🎉\n```\n']
	];
	for (const [label, src] of rebuildInverse) {
		it(`rebuild reproduces the parsed raw of ${label}`, () => {
			const node = parseMermaid(src);
			rebuildMermaidRaw(node);
			expect(node.raw).toBe(src);
		});
	}

	it('re-emits an edited code inside the same fence byte-exactly', () => {
		const node = parseMermaid('```mermaid\ngraph TD\n\tA --> B\n```\n');
		patchCode(node, 'flowchart LR\n\tX --> Y\n');
		rebuildMermaidRaw(node);
		expect(node.raw).toBe('```mermaid\nflowchart LR\n\tX --> Y\n```\n');
	});

	it('preserves the opener info and closer bytes across a code edit', () => {
		const node = parseMermaid('  ~~~~mermaid extra\r\nold\r\n  ~~~~~ \r\n');
		patchCode(node, 'new\n');
		rebuildMermaidRaw(node);
		expect(node.raw).toBe('  ~~~~mermaid extra\r\nnew\n  ~~~~~ \r\n');
	});

	it('is deterministic across repeated rebuilds (G1.13)', () => {
		const node = parseMermaid('```mermaid\ngraph TD\n```\n');
		rebuildMermaidRaw(node);
		const first = node.raw;
		rebuildMermaidRaw(node);
		expect(node.raw).toBe(first);
	});
});
