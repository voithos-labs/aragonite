import { afterEach, expect, it } from 'vitest';

import { parse } from '../../core/parser';
import { disablePerfInstruments, enablePerfInstruments } from '../../perf/instruments';
import { createSharingState } from '../../tree-operations/sharing';
import { ensureUnsharedPath, rebuildUnsharedChain } from '../../tree-operations/unshare';

// The point of the child spans: a keystroke rewrites one region instead of re-joining the
// container. Wall-clock cannot say which happened on a given host; counting the sibling
// elements the rebuild reads can, and it fails the day the hint stops reaching a level.
// Instrumented, because that is the one dev shape without G1.38's rebuild behind the splice.
afterEach(disablePerfInstruments);

it('a keystroke inside a large container reads O(1) sibling elements, not O(children)', () => {
	enablePerfInstruments();
	const count = 2000;
	const source = Array.from({ length: count }, (_, i) => `- item ${i}\n`).join('');
	const sharing = createSharingState();
	const doc = parse(source);
	const path = [0, 900, 0];
	const chain = ensureUnsharedPath(doc, path, sharing);
	// The seeding pass is the O(children) one, and it is what the hinted pass then rides.
	rebuildUnsharedChain(doc, chain, sharing, null, undefined);

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
	rebuildUnsharedChain(doc, chain, sharing, null, undefined, { path, leafPreviousRaw });

	expect(list.raw).toBe(source.replace('- item 900\n', '- item 900 edited\n'));
	expect(reads).toBeLessThan(10);
});

// The other half of the same rule: a hint rides up from the door that named the leaf's bytes and
// from nowhere else, so a structural caller re-derives at every level (`editor.md` § 9). A fresh
// spans array is what a full rebuild leaves behind; the splice writes the one it was handed.
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
		rebuildUnsharedChain(doc, chain, sharing, null, undefined);
		return chain;
	};

	const hintless = parse(source);
	const hintlessSharing = createSharingState();
	const hintlessChain = seeded(hintless, hintlessSharing);
	const beforeHintless = spansOf(hintless);
	hintlessChain[2].raw = 'body edited\n';
	rebuildUnsharedChain(hintless, hintlessChain, hintlessSharing, null, undefined);
	expect(spansOf(hintless)[0]).not.toBe(beforeHintless[0]);
	expect(spansOf(hintless)[1]).not.toBe(beforeHintless[1]);

	const hinted = parse(source);
	const hintedSharing = createSharingState();
	const hintedChain = seeded(hinted, hintedSharing);
	const beforeHinted = spansOf(hinted);
	const leafPreviousRaw = hintedChain[2].raw;
	hintedChain[2].raw = 'body edited\n';
	rebuildUnsharedChain(hinted, hintedChain, hintedSharing, null, undefined, {
		path,
		leafPreviousRaw
	});
	expect(spansOf(hinted)[0]).toBe(beforeHinted[0]);
	expect(spansOf(hinted)[1]).toBe(beforeHinted[1]);
	expect(hinted.children[0].raw).toBe('- one\n\n  body edited\n\n  tail\n');
});
