/**
 * How bytes written at one leaf position are stored and read back, so a live rewrite that removes
 * bytes checks its candidate the way a reload will read it there. Only
 * `tree-operations/stored-as.ts` makes one, so a rewrite can't describe its own position.
 */

import type { Document } from '../core/nodes';
import type { Reading } from './reading';

declare const storedAsBrand: unique symbol;

export interface StoredAs {
	readonly reading: Reading;
	/** `inline`: the position stores text, never a block (a table cell, a title row). */
	readonly surface: 'block' | 'inline';
	/** The bytes the position keeps: the kind's write rule, then its container's body rule. */
	stored(bytes: string): string;
	/** Stored bytes read as a reload reads them at the position, or null where the reload would
	 *  read the container around them differently. */
	readSlot(stored: string): Document | null;
	/** Bytes a write installs at the position, read as it installs them: every byte kept. */
	readWritten(bytes: string): Document;
	readonly [storedAsBrand]: true;
}
