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
