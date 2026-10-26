// Blocks placed after a code fence left open become its body, the way a reload reads them.
// Miss-analysis: the exhaustive suites type, delete and split but never place blocks, so no row
// put a block below a fence that reads on to the end of the list.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { spliceList } from '#lib/tree-operations/node-primitives.js';
import { settled } from '#lib/test/harness/settle-funnel.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';

describe('a block placed after a fence left open', () => {
	it.each([
		['a paragraph', 'y\n'],
		['a quote', '> q\n'],
		['two CRLF lines', 'y\r\nz\r\n']
	])('%s becomes the fence body', (_label, placed) => {
		const doc = parse('```\nx\n');
		const blocks = parse(placed).children;

		settled(doc, (body) => {
			spliceList(body, 1, 0, blocks);
			return { op: 'insert', at: 1, count: blocks.length };
		});

		expect(doc.children.map((c) => c.kind)).toEqual(['fencedCode']);
		expect(serialize(doc)).toBe(`\`\`\`\nx\n${placed}`);
		expect(describeConvergence(doc)).toBeNull();
	});
});
