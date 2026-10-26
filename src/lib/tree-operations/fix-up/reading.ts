// What the package asks the host, phrased for a list.
import { isBlankText } from '../../core/lines';
import type { Work } from './work';
import type { CstNode, Document } from '../../core/nodes';
import type { Host } from './types';

/** The host builds its table of kinds with its grammar, on first use: kind traits asked earlier
 *  come back empty. */
export const prime = (host: Host): void => void host.readingsThatMayChange();

export const isBlankBlock = (node: CstNode | undefined): boolean =>
	node?.kind === 'paragraph' && isBlankText(node.raw);

/** `text` read as the blocks from `index` of the list `owner` is the body of. */
export function readAt(
	host: Host,
	owner: CstNode | undefined,
	index: number,
	text: string
): Document {
	return owner ? host.readInSlot(owner, index, text) : host.readOpened(text);
}

/** The bytes of `blocks[lo, hi]`, the first block's blank lines left out. */
export function bytesOf(blocks: { at(i: number): CstNode }, lo: number, hi: number): string {
	let text = blocks.at(lo).raw;
	for (let i = lo + 1; i <= hi; i++) text += blocks.at(i).leadingTrivia + blocks.at(i).raw;
	return text;
}

/** Whether `node` takes in every line below it until a closer that hasn't come. */
export const readsOn = (host: Host, node: CstNode): boolean =>
	host.readingsThatMayChange().some((reading) => reading.readsOn && reading.notFinal(node.raw));

/** A leaf whose bytes end in a blank line its own reading leaves out, which it holds as its own. */
export const ownsBlankLine = (
	host: Host,
	owner: CstNode | undefined,
	index: number,
	node: CstNode
): boolean =>
	!node.children &&
	/\n[ \t]*\r?\n$/.test(node.raw) &&
	readAt(host, owner, index, node.raw).suffix !== '';

/** Where a container's body starts: past the title row it keeps first, which is no body block. */
export function bodyStart(work: Work, host: Host): number {
	const owner = work.list.owner;
	const title = owner && host.kindTraits(owner.kind).titleRowKind;
	return title && work.blocks.at(0)?.kind === title ? 1 : 0;
}
