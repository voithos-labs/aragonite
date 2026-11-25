/**
 * A maker's body writer as the byte changes `Draft.body` lands: a shape writes the block's bytes
 * with the new body, and the lines that changed become changes in document bytes, each line added
 * inside a quote or a list given the markers the block's other lines carry. Only a block type made
 * by a maker has one, so an app with no such type ships none of it.
 */

import { firstLineEnding, splitLines, type LineEnding, type ParsedLine } from '../../core/lines';
import type { NodeView } from '../../core/node-views';
import type { BlockMaking } from '../../schema/block-type';

/** `write` turned into the block type's `writeBody`. */
export function bodyWriter(
	write: (node: NodeView, text: string, ending: LineEnding) => string | null
): NonNullable<BlockMaking['writeBody']> {
	return (node, text, { source, byteAt, eol }) => {
		// A block holding any CRLF line writes CRLF, so no pair it had turns into a lone line feed.
		const ending = node.raw.includes('\r\n') ? '\r\n' : (firstLineEnding(node.raw) ?? eol);
		const written = write(node, text, ending);
		return written === null ? null : lineChanges(byteAt, source, node.raw, written);
	};
}

/** The changes that turn a block's bytes `was` into `now`: the lines between those both keep. */
function lineChanges(byteAt: (offset: number) => number, source: string, was: string, now: string) {
	const a = splitLines(was);
	const b = splitLines(now);
	let head = 0;
	while (head < a.length && head < b.length && a[head].raw === b[head].raw) head++;
	let tail = 0;
	const most = Math.min(a.length, b.length) - head;
	while (tail < most && a[a.length - 1 - tail].raw === b[b.length - 1 - tail].raw) tail++;
	const gone = a.slice(head, a.length - tail);
	const added = b.slice(head, b.length - tail);
	const at = (line: ParsedLine) => byteAt(line.start);
	const lineStart = (byte: number) => source.lastIndexOf('\n', byte - 1) + 1;
	const markersOf = (line: ParsedLine) => source.slice(lineStart(at(line)), at(line));
	const endOf = (line: ParsedLine) => at(line) + line.raw.length;
	if (gone.length === added.length) {
		return gone.map((line, i) => ({ from: at(line), to: endOf(line), insert: added[i].raw }));
	}
	// A line after the first carries the containers' markers alone; the first may hold an item's.
	const later = a[1];
	const marks = later ? markersOf(later) : markersOf(a[0]).replace(ITEM_MARKER, spaces);
	const joined = (lines: ParsedLine[]) => lines.map((line) => marks + line.raw).join('');
	if (gone.length === 0) {
		const before = a[head];
		// Lines added after the last land past its line break; before a line, past its markers.
		const from = before ? at(before) : endOf(a[a.length - 1]);
		const insert = before ? joined(added).slice(marks.length) + marks : joined(added);
		return [{ from, to: from, insert }];
	}
	const to = endOf(gone[gone.length - 1]);
	if (added.length === 0) return [{ from: lineStart(at(gone[0])), to, insert: '' }];
	return [{ from: at(gone[0]), to, insert: joined(added).slice(marks.length) }];
}

// A list item's marker and its task box, which the lines after its first indent past.
const ITEM_MARKER = /[-*+]|\d{1,9}[.)]|\[[ xX]\]/g;
const spaces = (run: string) => ' '.repeat(run.length);
