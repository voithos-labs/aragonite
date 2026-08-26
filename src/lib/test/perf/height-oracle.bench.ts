// The height model seeds one estimate per child of a mounted scope, so loading 400,000 blocks
// pays this 400,000 times before a single one paints. Nodes are synthesized rather than parsed:
// the estimate reads kind, raw and child count only, and a 20MB parse would dominate the setup.
import { bench, describe } from 'vitest';
import { makeBlockNode, type BlockMetadata, type CstNode } from '../../core/nodes';
import { createHeightOracle, type HeightOracle } from '../../cursor/height-oracle';

const OPTS = {
	lineHeight: 24,
	codeLineHeight: 20,
	avgCharWidth: 8,
	blockChrome: 12,
	imageBlockMinHeight: 200
};
const WIDTH = 700;
const COUNT = 400_000;

const leaf = (kind: string, raw: string, metadata?: BlockMetadata): CstNode =>
	makeBlockNode({ kind: kind as CstNode['kind'], leadingTrivia: '', raw, metadata });

const paragraph = (i: number): CstNode => leaf('paragraph', `block ${i} of ordinary prose text\n`);

/** The kinds a real document mixes, including the image arm the prose estimate branches on. */
function mixed(i: number): CstNode {
	switch (i % 6) {
		case 1:
			return leaf('heading', `## section ${i}\n`, { level: 2 });
		case 2:
			return leaf('fencedCode', '```js\nconst a = 1;\nconst b = 2;\n```\n', {
				language: 'js',
				fence: '```',
				info: 'js'
			} as unknown as BlockMetadata);
		case 3:
			return leaf('paragraph', `see ![diagram ${i}|400x300](/img/${i}.png) above\n`);
		case 4:
			return makeBlockNode({
				kind: 'blockquote',
				leadingTrivia: '',
				raw: `> quoted ${i}\n> and more\n`,
				metadata: { quoteDepth: 1 },
				children: [paragraph(i), paragraph(i + 1)]
			});
		case 5:
			return leaf('thematicBreak', '---\n', { marker: '-' } as unknown as BlockMetadata);
		default:
			return paragraph(i);
	}
}

function build(shape: (i: number) => CstNode): { nodes: CstNode[]; ids: string[] } {
	const nodes = new Array<CstNode>(COUNT);
	const ids = new Array<string>(COUNT);
	for (let i = 0; i < COUNT; i++) {
		nodes[i] = shape(i);
		ids[i] = `b-${i}`;
	}
	return { nodes, ids };
}

/** `buildModel`'s own loop (`reactivity/list-windowing.svelte.ts`), minus the reactive scope. */
function seed(oracle: HeightOracle, nodes: CstNode[], ids: string[]): number[] {
	const heights = new Array<number>(nodes.length);
	for (let i = 0; i < nodes.length; i++) heights[i] = oracle.height(ids[i], nodes[i], WIDTH);
	return heights;
}

describe('height seeding', () => {
	const oracle = createHeightOracle(OPTS);
	for (const [label, shape] of [
		['400k paragraphs', paragraph],
		['400k mixed kinds', mixed]
	] as const) {
		const { nodes, ids } = build(shape);
		bench(
			`seed ${label}`,
			() => {
				seed(oracle, nodes, ids);
			},
			{ warmupIterations: 1, time: 3_000 }
		);
	}
});
