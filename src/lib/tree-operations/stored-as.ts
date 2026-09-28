/**
 * The one maker of `StoredAs`: how a leaf position stores and reads back bytes, derived from the
 * tree. A store reads the tree the first time it is asked and keeps that answer, so make one per
 * gesture, at the gesture, and drop it after (`docs/design/live-mode.md` § 4.5).
 */

import type { DocumentView } from '../core/node-views';
import { documentLineEnding } from '../core/lines';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import type { Reading } from '../schema/reading';
import type { StoredAs } from '../schema/stored-as';
import { legalizeWrite, type WriteTarget } from './content-write';
import { childSlotAt, fragmentReaderAt, readThroughItemMarker } from './list/task-paragraph';

/** The leaf at `path` in `doc`: the store its bytes go through, read when first asked. */
export function storedAsAt(doc: DocumentView, path: readonly number[], reading: Reading): StoredAs {
	return storeOver(reading, () => {
		const { owner, index } = childSlotAt(doc, path);
		const holder: WriteTarget = owner
			? { owner, children: owner.children ?? [], lineEnding: documentLineEnding(doc) }
			: doc;
		return { holder, index };
	});
}

/** The same for slot `index` of a holder a caller already walked to, such as a join's target. */
export function storedAsIn(holder: WriteTarget, index: number, reading: Reading): StoredAs {
	return storeOver(reading, () => ({ holder, index }));
}

// ── The store ────────────────────────────────────────────────────────────────

interface Slot {
	holder: WriteTarget;
	index: number;
}

function storeOver(reading: Reading, locate: () => Slot): StoredAs {
	let found: Slot | undefined;
	const slot = (): Slot => (found ??= locate());
	return {
		reading,
		get surface() {
			const { holder, index } = slot();
			// A kind with no recognizer of its own stores text the parser never reads as a block.
			const kind = holder.children[index].kind;
			return tryGetBlockKindDescriptor(kind)?.contextDependentKind ? 'inline' : 'block';
		},
		get lineEnding() {
			const { holder } = slot();
			return 'lineEnding' in holder ? holder.lineEnding : documentLineEnding(holder);
		},
		stored(bytes) {
			const { holder, index } = slot();
			return legalizeWrite(holder, index, bytes, 'literal').text;
		},
		readSlot(stored) {
			const { holder, index } = slot();
			const owner = 'owner' in holder ? holder.owner : undefined;
			if (index === 0 && owner?.kind === 'listItem') {
				return readThroughItemMarker(owner, stored, reading.grammar);
			}
			return fragmentReaderAt(owner, index, reading.grammar)(stored);
		}
	} as StoredAs;
}
