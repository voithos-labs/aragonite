// The range-edit layout reads every block back from the document's bytes (G4.313): each block's
// span starts at its first byte and ends past its own line ending, never on the next line's
// markers, and each container line past its marker holds the next line of what its children write.
// Where each text offset sits is the byte map's, held by `tree-operations/byte-layout-parity.test.ts`.

import { it, expect } from 'vitest';
import fc from 'fast-check';
import type { NodeView } from '#lib/core/node-views.js';
import { splitLines } from '#lib/core/lines.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { reservedChromeKindOf } from '#lib/schema/reserved-chrome.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { arbLawDocument } from '../range-laws/shapes';

const EXTRA = [
	'> [!NOTE]\n> alpha\n> beta\n\nafter\n',
	':::note Title\nbody\n\nmore\n:::\n\nafter\n',
	'[^1]: a\n    b\n\n    c\n',
	'<details>\n<summary>S</summary>\n\nHidden\n\n</details>\n',
	'<details>\n<summary>S</summary>\r\nmixed\n</details>\r\n',
	'> a\r\n> > b\r\n>\r\n> c\r\n',
	'- [ ] task\n  more\n\n  1. n\n',
	'| a | b |\n|---|---|\n| 1 |  |\n\nafter\n'
];

/** What a container's children write, its title row first, as its lines carry them. */
function bodyOf(node: NodeView): string {
	const children = node.children ?? [];
	const titled = reservedChromeKindOf(node.kind) !== undefined;
	const own = (child: NodeView) => child.leadingTrivia + child.raw;
	const rest = children
		.slice(titled ? 1 : 0)
		.map(own)
		.join('');
	return (
		(titled ? own(children[0]) : '') + (node.innerPrefix ?? '') + rest + (node.innerSuffix ?? '')
	);
}

/** A line the layout reads matches a body line: the same, the same past a tab its marker cut, a
 *  title held inside a tag (`S</summary>`), or a blank line, whose spaces any marker may hold. */
function sameLine(laid: string, body: string): boolean {
	if (laid === body || (laid.trim() === '' && body.trim() === '')) return true;
	if (laid.includes('\t') && laid.trimStart() === body.trimStart()) return true;
	const text = body.replace(/\r?\n$/, '');
	return text !== '' && laid.startsWith(text) && /^<\/\w+>\s*$/.test(laid.slice(text.length));
}

it('every block and container line reads back from the bytes', () => {
	installPlugins([...SYNTAX_PLUGINS, mermaidPlugin()]);
	const grammar = defaultGrammarView;
	const docs = [...EXTRA, ...fc.sample(arbLawDocument, { numRuns: 150, seed: 20261106 })];
	const misses: string[] = [];
	for (const source of docs) {
		const doc = readAsOpened(source, { grammar, scope: 'document' });
		const layout = documentLayout(doc);
		const q = (what: string) => misses.push(`${JSON.stringify(source)} ${what}`);
		for (const block of layout.blocks) {
			const node = blockNodeAt(doc, block.path)!;
			const ending = /\r?\n$/.exec(node.raw)?.[0] ?? '';
			if (source.slice(block.to - ending.length, block.to) !== ending || block.from > block.to)
				q(`[${block.path}] ends at ${block.to}, not past its own line ending`);
			const first = node.raw.trimStart()[0];
			if (first && source.slice(block.from).trimStart()[0] !== first)
				q(`[${block.path}] starts at ${block.from}, not at its first byte`);
			if (!block.lines) continue;
			const bodyLines = splitLines(bodyOf(node)).map((line) => line.raw);
			const laid = block.lines
				.filter((line) => !line.own)
				.map((line) => source.slice(line.markerTo, line.to));
			if (laid.length !== bodyLines.length || laid.some((line, i) => !sameLine(line, bodyLines[i])))
				q(
					`[${block.path}] lines ${JSON.stringify(laid)}, its children ${JSON.stringify(bodyLines)}`
				);
		}
	}
	expect(misses.slice(0, 15)).toEqual([]);
});
