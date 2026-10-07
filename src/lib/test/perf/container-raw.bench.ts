// Every keystroke inside a nested container rebuilds the raw of every ancestor. These rows time
// the real `rebuildUnsharedChain` over an already-copied chain along three axes: depth, breadth
// (the cost of re-joining children), and the two together.
import { describe, test } from 'vitest';
import { BENCH_TIMEOUT } from './fixtures/bench-timeout';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { enablePerfInstruments } from '../../perf/instruments';
import { dropChildSpans } from '../../schema/child-spans';
import { createSharingState } from '../../tree-operations/sharing';
import { rebuildUnsharedChain } from '../../tree-operations/chain-rebuild';
import { generateDeepNested, generateDeepProse, generateFixture } from './fixtures/generate';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

// Keeps the dev-only check that re-derives each splice (G1.38) out of every row's timing.
enablePerfInstruments();

function deepestChain(node: CstNode, chain: CstNode[] = []): CstNode[] {
	chain.push(node);
	const containerChild = node.children?.find((c) => c.children);
	return containerChild ? deepestChain(containerChild, chain) : chain;
}

// A fresh sharing state shares nothing, so the chain is already owned: steady typing, where the
// debounced snapshot shares it again only about every 250ms.
function benchAncestryRebuild(
	label: string,
	root: CstNode,
	opts: { iterations?: number; time?: number }
): void {
	const chain = deepestChain(root);
	const sharing = createSharingState();
	test(label, { timeout: BENCH_TIMEOUT }, async ({ bench }) => {
		await bench(label, () => {
			rebuildUnsharedChain(root, chain, sharing, null, defaultGrammarView);
		}).run({ warmupIterations: 1, ...opts });
	});
}

function singleFlatList(targetBytes: number): string {
	const lines: string[] = [];
	for (let i = 0, size = 0; size < targetBytes; i++) {
		const line = `- item ${i}\n`;
		lines.push(line);
		size += line.length;
	}
	return lines.join('');
}

describe('ancestry rebuild: depth axis', () => {
	const doc = parse(generateFixture('nested-containers', 1_000_000));
	const chain = deepestChain(doc.children.find((c) => c.kind === 'list')!);
	benchAncestryRebuild(`rebuild depth-${chain.length} ancestry (many tiny lists, 1MB)`, chain[0], {
		iterations: 50
	});
});

describe('ancestry rebuild: breadth axis', () => {
	const SIZES: Array<[label: string, bytes: number, opts: { iterations?: number; time?: number }]> =
		[
			['100KB', 100_000, { iterations: 50 }],
			['1MB', 1_000_000, { iterations: 10 }],
			['10MB', 10_000_000, { time: 3_000 }]
		];
	for (const [label, bytes, opts] of SIZES) {
		const doc = parse(singleFlatList(bytes));
		benchAncestryRebuild(`rebuild breadth: single ${label} list`, doc.children[0], opts);
	}
});

// An edit deep inside a large container: `full` re-joins every child, `spliced` rewrites only the
// changed child's region. Plain objects understate the gap, which is one `$state` read per child.
describe('ancestry rebuild: interior keystroke, hint vs full', () => {
	const doc = parse(singleFlatList(1_000_000));
	const list = doc.children[0];
	const middle = Math.floor(list.children!.length / 2);
	const path = [0, middle, 0];

	for (const hinted of [false, true]) {
		const item = list.children![middle];
		const chain = [list, item, item.children![0]];
		const sharing = createSharingState();
		rebuildUnsharedChain(list, chain, sharing, null, defaultGrammarView);
		const leaf = chain[2];
		let longer = false;
		const label = `rebuild interior of a 1MB list (${hinted ? 'spliced' : 'full'})`;
		test(label, { timeout: BENCH_TIMEOUT }, async ({ bench }) => {
			await bench(label, () => {
				const leafPreviousRaw = leaf.raw;
				// Alternating lengths, so the shift in spans is measured rather than skipped.
				longer = !longer;
				leaf.raw = longer ? 'item edited\n' : 'item edit\n';
				// No child spans means no region to rewrite, so the rebuild re-joins every child.
				if (!hinted) {
					dropChildSpans(list);
					dropChildSpans(item);
				}
				rebuildUnsharedChain(
					list,
					chain,
					sharing,
					null,
					defaultGrammarView,
					hinted ? { path, leafPreviousRaw } : undefined
				);
			}).run({ warmupIterations: 1, iterations: 20 });
		});
	}
});

// Every ancestor level holds a lot of raw, so one rebuild costs the sum of raw across levels. The
// adversarial row is past anything realistic, so it is reported rather than judged.
describe('ancestry rebuild: combined depth × bytes axis', () => {
	const DEPTHS = [4, 8, 12] as const;
	const PER_LEVEL: Array<[label: string, bytes: number]> = [
		['1KB', 1_000],
		['10KB', 10_000],
		['50KB', 50_000]
	];
	for (const depth of DEPTHS) {
		for (const [byteLabel, bytes] of PER_LEVEL) {
			const doc = parse(generateDeepNested(depth, bytes));
			benchAncestryRebuild(
				`rebuild deep-nested: depth ${depth} × ${byteLabel}/level`,
				doc.children[0],
				{
					iterations: 30
				}
			);
		}
	}

	const adversarial = parse(generateDeepNested(16, 100_000));
	benchAncestryRebuild(
		'rebuild deep-nested: depth 16 × 100KB/level (adversarial)',
		adversarial.children[0],
		{
			iterations: 20
		}
	);
});

// The same nesting with prose-length lines, where the deep-nested rows write each level as one
// long line: the rebuild's per-line work shows here, the per-byte work there.
describe('ancestry rebuild: prose lines', () => {
	const SHAPES: Array<[depth: number, label: string, bytes: number]> = [
		[4, '10KB', 10_000],
		[8, '10KB', 10_000],
		[8, '50KB', 50_000],
		[12, '10KB', 10_000]
	];
	for (const [depth, byteLabel, bytes] of SHAPES) {
		const doc = parse(generateDeepProse(depth, bytes));
		benchAncestryRebuild(
			`rebuild deep prose: depth ${depth} × ${byteLabel}/level`,
			doc.children[0],
			{
				iterations: 30
			}
		);
	}
});
