/**
 * Pure paste pipeline for fenced code blocks. Splices text into the
 * display at a selection range, bumping the outer fence length when the
 * pasted content contains a fence-marker run that would otherwise
 * terminate the block. Returns the new display text and cursor position.
 *
 * No DOM, no Svelte, no CST mutation — the orchestration layer reads the
 * display / selection from the contenteditable, calls this, and writes
 * the result back through `updateBlockContent`.
 */

export interface CodePasteInput {
	/** Current display text (textContent minus the trailing line ending). */
	display: string;
	/** Paste site: collapsed for a cursor paste, non-collapsed for a replacement. */
	selection: { start: number; end: number };
	/** Raw paste payload — plain text only. */
	pasted: string;
	/** Fence marker from the block's metadata. */
	fenceMarker: '`' | '~';
	/** Opener fence length from the block's metadata. */
	fenceLength: number;
	/** Whether the block currently has a closing fence. */
	closed: boolean;
}

export interface CodePasteResult {
	/** New display text after splice + optional fence bump. */
	text: string;
	/** Cursor position after the paste — at the end of the inserted content. */
	cursor: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Produce the post-paste display text and cursor position. When the paste
 * contains a run of `fenceMarker` of length ≥ `fenceLength`, the outer
 * fence is bumped to one longer than the run so the paste stays literal
 * inside the block. For closed blocks both the opener and the closer fence
 * lines are bumped; unclosed blocks bump only the opener.
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

/**
 * Longest consecutive run of `fenceChar` in `text`, or 0 if none. Used by
 * the paste handler to decide whether the outer fence needs bumping; also
 * useful to the CodeBlock paste orchestration directly when it needs to
 * decide whether to even involve the paste helper.
 */
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
 * Replace the opener fence on line 0 and — for closed blocks — the closer
 * fence on the last non-blank line. Body lines are untouched even if they
 * contain fence runs, because the fence-bump rule cares only about lines
 * the parser would interpret as opener / closer.
 */
function bumpFenceLines(
	spliced: string,
	oldFence: string,
	newFence: string,
	closed: boolean
): string {
	const lines = spliced.split('\n');
	lines[0] = lines[0].replace(new RegExp('^' + escapeForRegex(oldFence)), newFence);

	if (closed) {
		for (let i = lines.length - 1; i >= 0; i--) {
			if (lines[i].trim().length === 0) continue;
			lines[i] = lines[i].replace(new RegExp('^\\s*' + escapeForRegex(oldFence)), newFence);
			break;
		}
	}

	return lines.join('\n');
}

function escapeForRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
