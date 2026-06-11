// Every keystroke inside a nested container pays a full ancestry raw rebuild;
// this measures that cost at the fixture's maximum nesting depth.
import { bench, describe } from 'vitest';
import type { CstNode } from '../../core/nodes';
import { parse } from '../../core/parser';
import { rebuildListItemRaw, rebuildListRaw } from '../../schema/container-raw';
import { generateFixture } from './fixtures/generate';

describe('ancestry rebuild at depth (nested fixture, 1MB)', () => {
	const doc = parse(generateFixture('nested-containers', 1_000_000));

	function deepestChain(node: CstNode, chain: CstNode[] = []): CstNode[] {
		chain.push(node);
		const containerChild = node.children?.find((c) => c.children);
		return containerChild ? deepestChain(containerChild, chain) : chain;
	}

	const chain = deepestChain(doc.children.find((c) => c.kind === 'list')!);
	bench(
		`rebuild ${chain.length}-deep ancestry`,
		() => {
			for (let i = chain.length - 1; i >= 0; i--) {
				const n = chain[i];
				if (n.kind === 'listItem') rebuildListItemRaw(n);
				else if (n.kind === 'list') rebuildListRaw(n);
			}
		},
		{ iterations: 50 }
	);
});
