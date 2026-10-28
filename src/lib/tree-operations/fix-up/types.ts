// What the list fix-up takes and returns, and what it asks the block parser. The fix-up never
// writes into what it is handed; it returns a patch over one list of sibling blocks.
import type { CstNode, Document } from '../../core/nodes';
import type { LineEnding } from '../../core/lines';
import type { ContainerBodyWrap } from '../../core/parser';
import type { UnfinishedReading } from '../../schema/block-openers';

/** One list of sibling blocks: the document's top level, or a container's body. */
export interface SiblingList {
	/** The container this list is the body of; absent for the document's own list. */
	readonly owner?: CstNode;
	readonly children: readonly CstNode[];
	/** The document's blank lines after its last block, on the document's list only. */
	readonly suffix?: string;
	readonly lineEnding: LineEnding;
}

/** Where an edit spliced the list, in the positions the list had before the edit. */
export interface Splice {
	readonly at: number;
	readonly removed: number;
	readonly added: number;
	/** For a placed block (by its index among `added`), the removed block it continues. */
	readonly keeps?: Readonly<Record<number, number>>;
}

/** What an edit did to a list, which arrives after the edit and before any fix-up. */
export interface ListEdit {
	/** The list before the edit; absent only for a typed write. */
	readonly before?: readonly CstNode[];
	/** The positions the edit spliced, or null when it wrote a block in place. */
	readonly span: Splice | null;
	readonly written?: { readonly index: number; readonly previous: CstNode; readonly text: string };
	/** Where a moved block stands, and the lower block of the pair the move left touching. */
	readonly moved?: { readonly to: number; readonly uncovered: number | null };
	/** A block deleted, on its own or after its text joined the block above. */
	readonly removed?: true;
	/** An open last line the edit left takes its ending from the blank lines below it, adding no
	 *  byte: a splice below a commit's own list keeps the bytes it was handed. */
	readonly endingsFromBelow?: true;
}

/** A block of a list and a byte offset into its `raw`. */
export interface Caret {
	readonly index: number;
	readonly offset: number;
}

/** Replace `children[at, at + removed)` of the list as given with `blocks`; every block outside
 *  that window stays the object it was. */
export interface ListResult {
	at: number;
	removed: number;
	blocks: CstNode[];
	/** For each of `blocks`, the position in the list as given whose block it continues, or -1. */
	keeps: number[];
	innerPrefix?: string;
	innerSuffix?: string;
	suffix?: string;
	caret?: Caret;
	/** Where the first byte of a written block's bytes ended up. */
	writtenStart?: Caret;
	movedTo?: number;
}

export interface KindTraits {
	/** Present when the kind's body sits between fence lines of its own. */
	bodyWrap?: ContainerBodyWrap;
	/** The kind of the title row a container keeps as its first child, when it keeps one. */
	titleRowKind?: string;
	/** The kind holds blocks of its own. */
	container: boolean;
	/** The kind has no reading of its own bytes alone (a title row only its container writes). */
	contextDependent: boolean;
	/** A container whose children are its lines, each behind its marker (a quote). */
	stripContainer: boolean;
	/** A table or a table row, whose cells sit inside one line. */
	grid: boolean;
}

/** The block parser the fix-up reads with; every answer is the parser's own. */
export interface Host {
	readOpened(text: string): Document;
	/** `text` read as block `index` of `owner`'s body reads it (behind a task marker, say). */
	readInSlot(owner: CstNode | undefined, index: number, text: string): Document;
	/** Whether a table right above a block with these bytes takes its first line as a row. */
	continuesTableAbove(raw: string): boolean;
	readingsThatMayChange(): readonly UnfinishedReading[];
	/** The topmost of the `count` blocks above that a line of `written` closes, or -1
	 *  (`schema/block-openers.ts :: waitingAboveClosedBy`). */
	waitingAboveClosedBy(
		written: readonly string[],
		rawAbove: (i: number) => string,
		count: number
	): number;
	kindTraits(kind: string): KindTraits;
	/** A copy of a container whose `raw` was rewritten from `rawBefore`, its metadata read again. */
	containerAfterRewrite(node: CstNode, rawBefore: string): { node: CstNode };
	/** Whether two lists read as one list once nothing parts them (their facing items' markers). */
	listsContinue(upper: CstNode, lower: CstNode): boolean;
	/** The child holding a container's last line, or -1 when its own bytes do. */
	childWithLastLine(node: CstNode): number;
}
