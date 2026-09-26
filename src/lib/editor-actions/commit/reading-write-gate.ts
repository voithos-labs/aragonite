/**
 * Reading mode writes no bytes, and every entry point that writes the document asks here first.
 * A write in reading mode is declined, and a dev build names the operation and its caller, since
 * the gesture that reached it offered a write the mode should not have. Ask synchronously, before
 * the first await, or the report loses the caller.
 */

import { splitLines } from '../../core/lines';
import { devWarn } from '../../dev-warn';
import { editorEnv } from '../../env';
import { isReadingMode } from '../../presentation-mode';
import type { Reading } from '../../schema/reading';

export const READING_WRITE_TAG = 'reading-write';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Whether a write naming `op` may land: false in reading mode, with a dev warning that names the
 * block kind `kindOf` answers, so a plugin author can tell which of their blocks asked.
 */
export function admitsWrite(
	reading: Reading,
	op: string,
	kindOf?: () => string | undefined
): boolean {
	if (!isReadOnly(reading)) return true;
	if (editorEnv.isDev) {
		const kind = kindOf?.();
		const on = kind ? `on a '${kind}' block, ` : '';
		devWarn(
			READING_WRITE_TAG,
			`declined '${op}' in reading mode, ${on}called from ${callerOf(new Error().stack)}`
		);
	}
	return false;
}

/**
 * For an undo snapshot pushed ahead of a write: declined in reading mode so no empty entry is
 * left on the stack, and silent, because the write that follows reports itself.
 */
export function admitsSnapshot(reading: Reading): boolean {
	return !isReadOnly(reading);
}

// ── Internal ────────────────────────────────────────────────────────────────

function isReadOnly(reading: Reading): boolean {
	return isReadingMode(() => reading.mode());
}

const FRAME = /^\s*at (?:async )?(?:(.+?) \()?.*?\/src\/lib\/([^\s:?)]+\.(?:ts|svelte))/;

// This module and the undo controller sit between every caller and the check.
const OWN_FILES = new Set([
	'editor-actions/commit/reading-write-gate.ts',
	'editor-actions/commit/undo-controller.ts'
]);

/** The nearest five editor frames outside the write machinery, innermost first. */
function callerOf(stack: string | undefined): string {
	const frames: string[] = [];
	for (const { text } of splitLines(stack ?? '')) {
		const match = FRAME.exec(text);
		if (!match || OWN_FILES.has(match[2])) continue;
		frames.push(match[1] ? `${match[1]} (${match[2]})` : match[2]);
		if (frames.length === 5) break;
	}
	return frames.length > 0 ? frames.join(' < ') : 'an unknown caller';
}
