// Miss-analysis: the strip stale-raw check compared only the children's bytes with the reparse, so
// a quote whose first line gained a `>` kept its old depth through every dev build.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib';
import { checkStaleRaw } from '#lib/invariants/node-shape.js';
import { getBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

describe('the strip stale-raw check compares metadata with the reparse', () => {
	// A bare `rebuildRaw` is a rebuild outside every route that re-reads the metadata.
	it('fires on a quote whose bare rebuild put a quote on its first line', () => {
		const node = parse('> a\n').children[0];
		node.children = parse('> a\n').children;
		getBlockKindDescriptor(node.kind).rebuildRaw!(node);

		const violation = checkStaleRaw(node, defaultGrammarView);
		expect(violation?.detail).toMatchObject({ reason: 'metadata-diverges' });
		expect(violation?.message).toContain('blockquote.quoteDepth: live 1 != reparsed 2');
	});

	it('fires on an item nested below, whose checkbox its bytes no longer hold', () => {
		const node = parse('> - [ ] a\n').children[0];
		const item = node.children![0].children![0];
		item.metadata = { marker: '- ', taskItem: true, taskChecked: true, taskMarker: '[ ] ' };

		expect(checkStaleRaw(node, defaultGrammarView)?.message).toContain(
			'listItem.taskChecked: live true != reparsed false'
		);
	});

	it('stays silent on a freshly parsed quote', () => {
		expect(checkStaleRaw(parse('> > - a\n').children[0], defaultGrammarView)).toBeNull();
	});
});
