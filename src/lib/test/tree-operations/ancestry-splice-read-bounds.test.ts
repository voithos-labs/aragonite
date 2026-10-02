import { afterEach, expect, it } from 'vitest';

import { parse } from '../../core/parser';
import { disablePerfInstruments, enablePerfInstruments } from '../../perf/instruments';
import { createSharingState } from '../../tree-operations/sharing';
import { ensureUnsharedPath } from '../../tree-operations/unshare';
import { rebuildUnsharedChain } from '../../tree-operations/chain-rebuild';
import { defaultGrammarView } from '$lib/schema/block-openers';

// Child spans let a keystroke rewrite one region instead of re-joining the container, which
// wall-clock time can't show on every host, so these tests count the sibling elements read.
// Perf instruments are on because they skip the dev check that re-derives each splice (G1.38).
afterEach(disablePerfInstruments);

it('a keystroke inside a large container reads O(1) sibling elements, not O(children)', () => {
	enablePerfInstruments();
	const count = 2000;
	const source = Array.from({ length: count }, (_, i) => `- item ${i}\n`).join('');
	const sharing = createSharingState();
	const doc = parse(source);
	const path = [0, 900, 0];
	const chain = ensureUnsharedPath(doc, path, sharing);
	// The first pass is the O(children) one, and the hinted pass then builds on it.
	rebuildUnsharedChain(doc, chain, sharing, null, defaultGrammarView);

	const list = doc.children[0];
	const items = list.children!;
	let reads = 0;
	list.children = new Proxy(items, {
		get(target, prop, receiver) {
			if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
			return Reflect.get(target, prop, receiver);
		}
	}) as typeof items;

	const leaf = chain[2];
	const leafPreviousRaw = leaf.raw;
	leaf.raw = 'item 900 edited\n';
	rebuildUnsharedChain(doc, chain, sharing, null, defaultGrammarView, { path, leafPreviousRaw });

	expect(list.raw).toBe(source.replace('- item 900\n', '- item 900 edited\n'));
	expect(reads).toBeLessThan(10);
});

// Only a caller that named the leaf's bytes passes a hint, so a structural rebuild re-derives each
// level; a fresh spans array marks a full rebuild, and a splice writes the one it was handed.
it('a hintless rebuild re-derives at every level, and a hinted one splices at every level', () => {
	const source = '- one\n\n  body\n\n  tail\n';
	const path = [0, 0, 1];

	const spansOf = (doc: ReturnType<typeof parse>) => {
		const list = doc.children[0];
		return [list.childSpans, list.children![0].childSpans];
	};
	const seeded = (
		doc: ReturnType<typeof parse>,
		sharing: ReturnType<typeof createSharingState>
	) => {
		const chain = ensureUnsharedPath(doc, path, sharing);
		rebuildUnsharedChain(doc, chain, sharing, null, defaultGrammarView);
		return chain;
	};

	const hintless = parse(source);
	const hintlessSharing = createSharingState();
	const hintlessChain = seeded(hintless, hintlessSharing);
	const beforeHintless = spansOf(hintless);
	hintlessChain[2].raw = 'body edited\n';
	rebuildUnsharedChain(hintless, hintlessChain, hintlessSharing, null, defaultGrammarView);
	expect(spansOf(hintless)[0]).not.toBe(beforeHintless[0]);
	expect(spansOf(hintless)[1]).not.toBe(beforeHintless[1]);

	const hinted = parse(source);
	const hintedSharing = createSharingState();
	const hintedChain = seeded(hinted, hintedSharing);
	const beforeHinted = spansOf(hinted);
	const leafPreviousRaw = hintedChain[2].raw;
	hintedChain[2].raw = 'body edited\n';
	rebuildUnsharedChain(hinted, hintedChain, hintedSharing, null, defaultGrammarView, {
		path,
		leafPreviousRaw
	});
	expect(spansOf(hinted)[0]).toBe(beforeHinted[0]);
	expect(spansOf(hinted)[1]).toBe(beforeHinted[1]);
	expect(hinted.children[0].raw).toBe('- one\n\n  body edited\n\n  tail\n');
});
