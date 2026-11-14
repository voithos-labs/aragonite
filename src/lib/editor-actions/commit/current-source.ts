/**
 * The document's Markdown, serialized once per content version. `getSource()` and the `source`
 * prop's swap check share it, so a host passing `getSource()` back hands over the same string.
 * It is only as fresh as the version: every byte writer must bump it (checked in dev, G1.52).
 * The text is read off the tree at every version, never off the record kept across writes, which
 * that read checks (`KeptStarts.saved`). While the tree may hold bytes the version
 * hasn't heard of (a write is open, or one threw), a read serializes the tree and keeps nothing.
 */

import { untrack } from 'svelte';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import type { Document } from '../../core/nodes';
import { serialize } from '../../core/serializer';
import { checkCurrentSource } from '../../invariants/current-source';
import { perfEnabled } from '../../perf/instruments';

export interface CurrentSourceDeps {
	version(): number;
	doc(): Document;
	/** The text read off the tree while every write has announced (`KeptStarts.saved`). */
	saved(): string;
	/** Whether the tree may hold bytes no version announced (`KeptStarts.unannounced`). */
	unannounced(): boolean;
}

export interface CurrentSource {
	/** The text; a dev build checks a reused one against the document once per version. */
	read(): string;
	/** The same text, never checked, for a reader an echoing host hits on every keystroke. */
	readUnchecked(): string;
}

export function createCurrentSource(deps: CurrentSourceDeps): CurrentSource {
	let servedVersion: number | null = null;
	let checkedVersion: number | null = null;
	let served = '';

	// Untracked, so a reactive caller subscribes to the version alone, the document's memo key.
	function serve(version: number, check: boolean): string {
		return untrack(() => {
			// Not kept: the write may yet put the tree back, under the same version.
			if (deps.unannounced()) return serialize(deps.doc());
			if (version !== servedVersion) {
				served = deps.saved();
				servedVersion = version;
			} else if (check && checkedVersion !== version && !perfEnabled()) {
				checkedVersion = version;
				assertInvariant('current-source', () => checkCurrentSource(served, deps.doc()));
			}
			return served;
		});
	}

	return {
		read: () => serve(deps.version(), true),
		readUnchecked: () => serve(deps.version(), false)
	};
}
