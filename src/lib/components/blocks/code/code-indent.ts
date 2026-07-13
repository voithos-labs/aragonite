/**
 * Pure tab-indent / tab-dedent for code-block text.
 * Multi-line selections touch every line whose offsets fall in [start, end).
 * Dedent removes one tab OR up to four leading spaces per line, preferring tab.
 */

export interface Selection {
	start: number;
	end: number;
}

export interface IndentResult {
	text: string;
	selection: Selection;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function indentLines(text: string, selection: Selection): IndentResult {
	if (selection.start === selection.end) {
		const at = selection.start;
		return {
			text: text.slice(0, at) + '\t' + text.slice(at),
			selection: { start: at + 1, end: at + 1 }
		};
	}

	const lineStarts = collectLineStarts(text, selection);
	let newText = text;
	for (let i = lineStarts.length - 1; i >= 0; i--) {
		const idx = lineStarts[i];
		newText = newText.slice(0, idx) + '\t' + newText.slice(idx);
	}
	return {
		text: newText,
		selection: {
			start: selection.start + 1,
			end: selection.end + lineStarts.length
		}
	};
}

export function dedentLines(text: string, selection: Selection): IndentResult {
	if (selection.start === selection.end) {
		const lineStart = text.lastIndexOf('\n', selection.start - 1) + 1;
		const removed = computeDedentCount(text, lineStart);
		if (removed === 0) return { text, selection };
		const newText = text.slice(0, lineStart) + text.slice(lineStart + removed);
		const newCursor = Math.max(lineStart, selection.start - removed);
		return { text: newText, selection: { start: newCursor, end: newCursor } };
	}

	const lineStarts = collectLineStarts(text, selection);
	let newText = text;
	let removedBeforeStart = 0;
	let removedWithin = 0;
	let removedOnFirstLine = 0;
	for (let i = lineStarts.length - 1; i >= 0; i--) {
		const idx = lineStarts[i];
		const removed = computeDedentCount(newText, idx);
		if (removed === 0) continue;
		newText = newText.slice(0, idx) + newText.slice(idx + removed);
		if (i === 0) removedOnFirstLine = removed;
		if (idx < selection.start) removedBeforeStart += removed;
		else removedWithin += removed;
	}

	const firstLineStart = lineStarts[0];
	return {
		text: newText,
		selection: {
			start: Math.max(firstLineStart, selection.start - removedOnFirstLine),
			end: selection.end - (removedBeforeStart + removedWithin)
		}
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Line-start offsets for every line the selection touches. A selection ending
 * at or before a line's terminating newline stays on that line; one ending at
 * the next line's start pulls that line in.
 */
function collectLineStarts(text: string, selection: Selection): number[] {
	const first = text.lastIndexOf('\n', selection.start - 1) + 1;
	const starts: number[] = [first];
	let pos = first;
	while (pos < selection.end) {
		const next = text.indexOf('\n', pos);
		if (next === -1 || next >= selection.end) break;
		starts.push(next + 1);
		pos = next + 1;
	}
	return starts;
}

function computeDedentCount(text: string, lineStart: number): number {
	if (text[lineStart] === '\t') return 1;
	let spaces = 0;
	while (spaces < 4 && text[lineStart + spaces] === ' ') spaces++;
	return spaces;
}
