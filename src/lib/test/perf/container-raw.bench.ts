// Every keystroke inside a nested container pays a full ancestry raw rebuild.
// Two axes: depth (nested fixture — thousands of tiny lists, so each rebuild
// touches little raw) and breadth (one flat list, where the list rebuild
// re-joins every item — the O(container-size) cliff).
import { bench, describe } from 'vitest';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { rebuildListItemRaw, rebuildListRaw } from '../../schema/container-rebuilders';
import { generateFixture } from './fixtures/generate';

function deepestChain(node: CstNode, chain: CstNode[] = []): CstNode[] {
	chain.push(node);
	const containerChild = node.children?.find((c) => c.children);
	return containerChild ? deepestChain(containerChild, chain) : chain;
}

function rebuildInnermostFirst(chain: CstNode[]): void {
	for (let i = chain.length - 1; i >= 0; i--) {
		const n = chain[i];
		if (n.kind === 'listItem') rebuildListItemRaw(n);
		else if (n.kind === 'list') rebuildListRaw(n);
	}
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

describe('ancestry rebuild — depth axis', () => {
	const doc = parse(generateFixture('nested-containers', 1_000_000));
	const chain = deepestChain(doc.children.find((c) => c.kind === 'list')!);
	bench(
		`rebuild depth-${chain.length} ancestry (many tiny lists, 1MB)`,
		() => {
			rebuildInnermostFirst(chain);
		},
		{ iterations: 50 }
	);
});

describe('ancestry rebuild — breadth axis', () => {
	const SIZES: Array<[label: string, bytes: number, opts: { iterations?: number; time?: number }]> =
		[
			['100KB', 100_000, { iterations: 50 }],
			['1MB', 1_000_000, { iterations: 10 }],
			['10MB', 10_000_000, { time: 3_000 }]
		];
	for (const [label, bytes, opts] of SIZES) {
		const doc = parse(singleFlatList(bytes));
		const chain = deepestChain(doc.children.find((c) => c.kind === 'list')!);
		bench(
			`rebuild breadth: single ${label} list`,
			() => {
				rebuildInnermostFirst(chain);
			},
			{ warmupIterations: 1, ...opts }
		);
	}
});
