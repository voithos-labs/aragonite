// The lines a removal never covered, after the block the range ends in: each stays a line of its
// own, in order, inside the same fenced containers, so a closing line it kept stands where it closes
// its own container (the spec's section 5.2). A line is matched by its text past its container
// markers, so a list renumbered or a marker moved to a new first line still finds it. The line the
// range starts on stays too, emptied, wherever its block does.

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
	const want = keptLines(host, read, atLineStart ? to : nextLine(source, leaf?.to ?? to));
	const lines = keptLines(host, readOf(host, got), got.lastIndexOf('\n', from - 1) + 1);
	let cursor = 0;
	for (const [i, line] of want.entries()) {
		if (line.text === '' && !(atLineStart && i === 0)) continue;
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

/** The first line starting at or after `at`. */
function nextLine(source: string, at: number): number {
	if (at === 0 || source[at - 1] === '\n') return at;
	const end = source.indexOf('\n', at);
	return end < 0 ? source.length : end + 1;
}

/** Each line from `start` on, past its markers. */
function keptLines(host: CheckHost, read: Read, start: number): KeptLine[] {
	const { source } = read;
	const out: KeptLine[] = [];
	for (let at = start; at < source.length;) {
		const end = source.indexOf('\n', at);
		const stop = end < 0 ? source.length : end + 1;
		const line = source.slice(at, stop).replace(/\r?\n$/, '');
		const marks = MARKERS.exec(line)![0].length;
		const textAt = at + marks;
		const fenced = read.blocks
			.filter((b) => host.facts(b.type).lines === 'fenced' && b.from <= textAt && textAt < b.to)
			.map((b) => b.type)
			.join('>');
		out.push({ text: line.slice(marks), fenced });
		at = stop;
	}
	return out;
}
