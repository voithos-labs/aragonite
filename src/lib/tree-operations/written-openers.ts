/**
 * The closers a write adds so that an opener it put on a line takes in no block below the write:
 * each written block left waiting on a closing line gets its reading's own, at its end. Answered
 * before any parse for a write whose changed lines wait on nothing, which is every keystroke in prose.
 */

import type { Document } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import {
	firstDisplayLine,
	ownTrailingLineEnding,
	splitLines,
	trimTrailingLineEnding
} from '../core/lines';
import { writtenSpan } from '../core/written-span';
import {
	unfinishedReadings,
	waitingReading,
	type GrammarView,
	type UnfinishedReading
} from '../schema/block-openers';
import { tryGetBlockKindDescriptor } from '../schema/block-kind-descriptor';
import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';
import { fragmentReaderAt, type FragmentReader } from './list/task-paragraph';

/** A closing line, ending and all, and where in the written text it goes. */
export interface WrittenCloser {
	at: number;
	text: string;
}

/** The closers a write of `text` over child `index`, whose bytes were `before`, needs, in text
 *  order; `children` are the write's siblings as they stand once it lands. */
export function writtenOpenerClosers(
	children: readonly NodeView[],
	index: number,
	before: string,
	text: string,
	read: FragmentReader,
	readings: readonly UnfinishedReading[]
): WrittenCloser[] {
	const next = children[index + 1];
	if (!next || !waitsOnWrittenLine(before, text, readings)) return [];
	const parsed = read(text);
	const span = writtenSpan(before, text);
	const blocks = parsed.children;
	const closers: WrittenCloser[] = [];
	let at = parsed.prefix.length;
	for (let k = 0; k < blocks.length; k++) {
		const block = blocks[k];
		const start = at + block.leadingTrivia.length;
		at = start + block.raw.length;
		const reading = waitingReading(block.raw, readings);
		if (!reading?.closer) continue;
		const lineEnd = start + firstDisplayLine(block.raw).text.length;
		// An opener the write only exposed reads on as a reload reads it, closer and all.
		if (span.start > lineEnd || span.end < start) continue;
		const last = k === blocks.length - 1;
		// The closer is a line of its own, so a last line left unterminated has nowhere to put one.
		const ending = ownTrailingLineEnding(last ? text : block.raw);
		if (ending === '') continue;
		if (last && takesCloserBelow(text, block, next, read, readings)) continue;
		if (!reading.readsOn && !takesBlocksBelow(children, index, text, parsed, k, reading, read))
			continue;
		closers.push({ at: last ? text.length : at, text: reading.closer(block.raw) + ending });
	}
	return closers;
}

/** G1.158: blocks `[at, at + count)` of `body`, spliced in over the bytes `before`, hold no opener
 *  they wrote that a block below would close; every route closes one first, so this fails one that didn't. */
export function checkSplicedOpenersClosed(
	body: { readonly children: readonly NodeView[]; readonly owner?: NodeView },
	at: number,
	count: number,
	before: string,
	grammar: GrammarView
): InvariantViolation | null {
	const last = at + count - 1;
	if (count <= 0 || last + 1 >= body.children.length) return null;
	const window = body.children.slice(at, last + 1);
	const contextual = (node: NodeView) => tryGetBlockKindDescriptor(node.kind)?.contextDependentKind;
	if (window.some(contextual)) return null;
	const text = window.map((node, k) => (k > 0 ? node.leadingTrivia : '') + node.raw).join('');
	const read = fragmentReaderAt(body.owner, at, grammar);
	const readings = unfinishedReadings(grammar);
	const closers = writtenOpenerClosers(body.children, last, before, text, read, readings);
	if (closers.length === 0) return null;
	return {
		code: 'spliced-opener-closed',
		message: `blocks ${at}-${last} were spliced in with an opener that reads down into the blocks below`,
		detail: { text, closers }
	};
}

/** `text` with `closers` written in. */
export function withClosers(text: string, closers: readonly WrittenCloser[]): string {
	let out = '';
	let from = 0;
	for (const closer of closers) {
		out += text.slice(from, closer.at) + closer.text;
		from = closer.at;
	}
	return out + text.slice(from);
}

/** Where `offset` lands once `closers` are written in; an offset at a closer stays in front of it. */
export function offsetPastClosers(offset: number, closers: readonly WrittenCloser[]): number {
	let shifted = offset;
	for (const closer of closers) if (closer.at < offset) shifted += closer.text.length;
	return shifted;
}

/** Whether the bytes from some line the write changed on wait for a closer, before any parse. */
function waitsOnWrittenLine(
	before: string,
	text: string,
	readings: readonly UnfinishedReading[]
): boolean {
	const span = writtenSpan(before, text);
	for (let at = text.lastIndexOf('\n', span.start - 1) + 1; at <= span.end && at < text.length;) {
		if (waitingReading(text.slice(at), readings) !== null) return true;
		const lineEnd = text.indexOf('\n', at);
		if (lineEnd < 0) break;
		at = lineEnd + 1;
	}
	return false;
}

/** Whether an opener typed back onto its body takes the closer flush beneath it; one typed on its
 *  own line, or with a blank line under it, gets a closer of its own. */
function takesCloserBelow(
	text: string,
	opened: NodeView,
	next: NodeView,
	read: FragmentReader,
	readings: readonly UnfinishedReading[]
): boolean {
	const hasBody = trimTrailingLineEnding(opened.raw).includes('\n');
	if (!hasBody || next.leadingTrivia !== '') return false;
	const head = read(text + firstDisplayLine(next.raw).text + ownTrailingLineEnding(text));
	const last = head.children[head.children.length - 1];
	return !last || waitingReading(last.raw, readings) === null;
}

/** Whether written block `k`, which only a closer below changes, takes blocks in down to one,
 *  read at each block holding a line that may close it, as the fix-up reads them. */
function takesBlocksBelow(
	children: readonly NodeView[],
	index: number,
	text: string,
	parsed: Document,
	k: number,
	reading: UnfinishedReading,
	read: FragmentReader
): boolean {
	let bytes = text;
	for (let i = index + 1; i < children.length; i++) {
		const node = children[i];
		bytes += node.leadingTrivia + node.raw;
		if (!splitLines(node.raw).some((line) => reading.mayClose(line.text))) continue;
		const reread = read(bytes).children[k];
		if (reread && reread.raw.length > parsed.children[k].raw.length) return true;
	}
	return false;
}
