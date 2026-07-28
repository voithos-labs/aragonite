/**
 * Pure paste pipeline for fenced code blocks. Splices text at a selection
 * range, bumping the outer fence length if the paste contains a fence-marker
 * run that would otherwise terminate the block.
 */

import { matchFenceClose } from '../../../core/parsers/fenced-code';

export interface CodePasteInput {
	display: string;
	selection: { start: number; end: number };
	pasted: string;
	fenceMarker: '`' | '~';
	fenceLength: number;
	closed: boolean;
}

export interface CodePasteResult {
	text: string;
	cursor: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * When the paste contains a run of `fenceMarker` of length ≥ `fenceLength`,
 * the outer fence grows to one longer than the run so the paste stays literal
 * inside the block. Closed blocks bump opener + closer; unclosed bumps opener only.
 */
export function computeCodePaste(input: CodePasteInput): CodePasteResult {
	const { display, selection, pasted, fenceMarker, fenceLength, closed } = input;
	const { start, end } = selection;

	const maxRunInPaste = scanLongestFenceRun(pasted, fenceMarker);
	const needsBump = maxRunInPaste >= fenceLength;

	if (!needsBump) {
		return {
			text: display.slice(0, start) + pasted + display.slice(end),
			cursor: start + pasted.length
		};
	}

	const newFenceLen = Math.max(fenceLength, maxRunInPaste + 1);
	const newFence = fenceMarker.repeat(newFenceLen);
	const oldFence = fenceMarker.repeat(fenceLength);

	const spliced = display.slice(0, start) + pasted + display.slice(end);
	const bumpedDisplay = bumpFenceLines(spliced, oldFence, newFence, closed);
	const fenceDelta = newFenceLen - fenceLength;

	return {
		text: bumpedDisplay,
		cursor: start + fenceDelta + pasted.length
	};
}

/** Longest consecutive run of `fenceChar` in `text`, or 0 if none. */
export function scanLongestFenceRun(text: string, fenceChar: '`' | '~'): number {
	let longest = 0;
	let current = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === fenceChar) {
			current++;
			if (current > longest) longest = current;
		} else {
			current = 0;
		}
	}
	return longest;
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Replace opener on line 0 and (when closed) closer on the last non-blank
 * line. Body lines are untouched — the fence-bump rule only cares about
 * lines the parser would treat as opener/closer.
 */
function bumpFenceLines(
	spliced: string,
	oldFence: string,
	newFence: string,
	closed: boolean
): string {
	const lines = spliced.split('\n');
	// GFM permits up to 3 spaces of indent before the opener; preserve it when bumping.
	lines[0] = lines[0].replace(new RegExp('^( {0,3})' + escapeForRegex(oldFence)), '$1' + newFence);

	if (closed) {
		const marker = oldFence[0] as '`' | '~';
		for (let i = lines.length - 1; i >= 0; i--) {
			if (lines[i].trim().length === 0) continue;
			// The parser decides what a closer is. A local regex here spelled the
			// grammar twice and more loosely — any leading whitespace, no end anchor —
			// so a tab-indented or info-bearing body line could be rewritten as if it
			// were the closer.
			if (matchFenceClose(lines[i], marker, oldFence.length)) {
				lines[i] = lines[i].replace(
					new RegExp('^( {0,3})' + escapeForRegex(oldFence)),
					'$1' + newFence
				);
			}
			break;
		}
	}

	return lines.join('\n');
}

function escapeForRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
