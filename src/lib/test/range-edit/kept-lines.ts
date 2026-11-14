// The lines a removal never covered, after the block the range ends in: each stays a line of its
// own, in order, inside the same fenced containers, so a closing line it kept stands where it closes
// its own container (the spec's section 5.2). A line is matched by its text past its container
// markers, so a list renumbered or a marker moved to a new first line still finds it. The line the
// range starts on stays too, emptied, wherever its block does. Where no text joins across the range,
// the lines after its end line stay byte for byte, each keeping its own markers once.

import { inTitleRow, leafAt, mixedEndings, readOf, type Read } from './expected';
import type { CheckHost } from './test-host';

interface KeptLine {
	/** The line's text past its container markers; empty for a blank line. */
	text: string;
	/** The fenced containers holding the text's first byte, outermost first. */
	fenced: string;
}

const MARKERS = /^(?:[ \t]*(?:>|[-*+](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$)|\[\^[^\]\s]+\]:))*[ \t]*/;

/** The line `got` lost, joined to another or moved across a closing line, as a report line; null
 *  where every line after the range's end block kept its place. */
export function movedLine(
	host: CheckHost,
	read: Read,
	from: number,
	to: number,
	got: string
): string | null {
	const { source } = read;
	const leaf = leafAt(read, to);
	// A range ending at a line's start, where no text joins, leaves that line starting a line.
	const atLineStart = !leaf && to > 0 && source[to - 1] === '\n';
	const closing = keptClosers(host, read, from, to);
	const after = keptLines(host, read, atLineStart ? to : nextLine(source, leaf?.to ?? to));
	const lines = keptLines(host, readOf(host, got), got.lastIndexOf('\n', from - 1) + 1);
	let cursor = 0;
	for (const [i, line] of [...closing, ...after].entries()) {
		if (line.text === '' && !(atLineStart && i === closing.length)) continue;
		const at = lines.findIndex((l, j) => j >= cursor && l.text === line.text);
		if (at < 0) return `lost the line ${JSON.stringify(line.text)}`;
		if (line.text !== '' && lines[at].fenced !== line.fenced)
			return `moved ${JSON.stringify(line.text)} from [${line.fenced}] into [${lines[at].fenced}]`;
		cursor = at + 1;
	}
	return null;
}

/** What `got` put right after the start, as a report line, where the block the range starts in
 *  stays and its line is neither ended there nor joined by the end line's text; null otherwise. */
export function gluedStart(
	host: CheckHost,
	read: Read,
	from: number,
	to: number,
	got: string
): string | null {
	const { source } = read;
	const oneLine = !source.slice(from, to).includes('\n');
	if (oneLine || !leafAt(read, from) || inTitleRow(read, from, host)) return null;
	// Mixed endings leave a lone `\r` on an emptied line, a defect of its own.
	if (mixedEndings(source)) return null;
	const whole = read.blocks.some(
		(b) => b.from === from && host.facts(b.type).joins !== 'text' && to >= (b.text?.to ?? b.to - 1)
	);
	const rest = got.slice(from);
	if (whole || /^[ \t]*(?:\r?\n|$)/.test(rest)) return null;
	const lineRest = (at: number) => /^[^\r\n]*/.exec(source.slice(at))![0].trim();
	// The end line's text joined the start's, or a closing fence the range started on came back.
	const joined = [lineRest(to), lineRest(from)].some(
		(t) => t !== '' && rest.trimStart().startsWith(t)
	);
	if (joined) return null;
	return `glued the start’s line to ${JSON.stringify(rest.slice(0, 24))}`;
}

/** The first line after the range's end line that `got` doesn't end with, byte for byte from a
 *  line's start, as a report line; null where it ends with all of them. */
export function rewrittenAfter(read: Read, to: number, got: string): string | null {
	const lineEnd = read.source.indexOf('\n', to);
	if (lineEnd < 0) return null;
	const below = read.source.slice(lineEnd + 1);
	// A blank line opening them may go with a block the range took, unless the end's block holds it.
	const after = textBelow(read, to) === null ? below.replace(/^(?:[ \t>]*\r?\n)+/, '') : below;
	const at = got.length - after.length;
	if (after === '' || (got.endsWith(after) && (at === 0 || got[at - 1] === '\n'))) return null;
	return `rewrote the line ${JSON.stringify(/^[^\r\n]*/.exec(after)![0])} after the range`;
}

/** Where the text of the block the range ends in goes on below the range's end line, past that
 *  line's markers; null where its text ends on the end line. */
export function textBelow(read: Read, to: number): number | null {
	const leaf = leafAt(read, to);
	const lineEnd = read.source.indexOf('\n', to);
	if (!leaf?.text || lineEnd < 0 || leaf.text.to <= lineEnd + 1) return null;
	for (let at = lineEnd + 1; at <= leaf.text.to; at++)
		if (read.layout.pointAt(at)?.path.join() === leaf.path.join()) return at;
	return null;
}

/** The first line starting at or after `at`. */
function nextLine(source: string, at: number): number {
	if (at === 0 || source[at - 1] === '\n') return at;
	const end = source.indexOf('\n', at);
	return end < 0 ? source.length : end + 1;
}

/** The closing lines the range covers of the fenced containers it starts inside, innermost first:
 *  the removal keeps each, since the container stays. */
function keptClosers(host: CheckHost, read: Read, from: number, to: number): KeptLine[] {
	const out: KeptLine[] = [];
	for (const block of [...read.blocks].reverse()) {
		const holds = block.from < from && from < block.to && block.linesIn;
		if (!holds || host.facts(block.type).lines !== 'fenced') continue;
		const last = [...block.linesIn!(block.from)].at(-1);
		if (!last?.own || from >= last.from || last.from >= to) continue;
		const lineStart = read.source.lastIndexOf('\n', last.from - 1) + 1;
		out.push(keptLines(host, read, lineStart, last.to)[0]);
	}
	return out;
}

/** Each line from `start` to `stop`, the document's end unless given, past its markers. */
function keptLines(host: CheckHost, read: Read, start: number, stop?: number): KeptLine[] {
	const source = read.source.slice(0, stop);
	const out: KeptLine[] = [];
	for (let at = start; at < source.length;) {
		const end = source.indexOf('\n', at);
		const next = end < 0 ? source.length : end + 1;
		const line = source.slice(at, next).replace(/\r?\n$/, '');
		const marks = MARKERS.exec(line)![0].length;
		const textAt = at + marks;
		const fenced = read.blocks
			.filter((b) => host.facts(b.type).lines === 'fenced' && b.from <= textAt && textAt < b.to)
			.map((b) => b.type)
			.join('>');
		out.push({ text: line.slice(marks), fenced });
		at = next;
	}
	return out;
}
