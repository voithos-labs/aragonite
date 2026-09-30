/**
 * The document's Markdown, serialized once per content version. `getSource()` and the `source`
 * prop's swap check share it, so a host passing `getSource()` back hands over the same string.
 * It is only as fresh as the version: every byte writer must bump it (checked in dev, G1.52).
 */

import { untrack } from 'svelte';
import { assertInvariant } from '../assert';
import type { Document } from '../core/nodes';
import { serialize } from '../core/serializer';
import { checkCurrentSource } from '../invariants/current-source';

export interface CurrentSourceDeps {
	version(): number;
	doc(): Document;
}

export function createCurrentSource(deps: CurrentSourceDeps): () => string {
	let servedVersion: number | null = null;
	let served = '';
	return () => {
		const version = deps.version();
		// Untracked, so a reactive caller subscribes to the version alone, the document's memo key.
		return untrack(() => {
			if (version !== servedVersion) {
				served = serialize(deps.doc());
				servedVersion = version;
			} else {
				assertInvariant('current-source', () => checkCurrentSource(served, deps.doc()));
			}
			return served;
		});
	};
}
