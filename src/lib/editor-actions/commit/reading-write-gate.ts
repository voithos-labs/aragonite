/**
 * Every entry point that writes the document asks here first. A write in reading mode is declined,
 * and so is one made for a document a `source` swap replaced; a dev build names either. Ask
 * synchronously, before the first await, or the report loses the caller and the write's stamp.
 */

import { splitLines } from '../../core/lines';
import { devWarn } from '../../dev-warn';
import { editorEnv } from '../../env';
import { isReadingMode } from '../../presentation-mode';
import type { Reading } from '../../schema/reading';
import { assertInvariant } from '../../assert';
import { checkDocumentStamp } from '../../invariants/stale-document-write';
import type { DocumentStamps } from './document-stamp';

export const READING_WRITE_TAG = 'reading-write';

// ── Public API ──────────────────────────────────────────────────────────────

/** What the gate reads: the mode, and the document the write being made was stamped with. */
export interface WriteGate {
	readonly reading: Reading;
	readonly stamps: DocumentStamps;
}

/**
 * Whether a write naming `op` may land: false for a document a swap replaced (G1.53), and false in
 * reading mode, with a dev warning that names the block kind `kindOf` answers.
 */
export function admitsWrite(
	gate: WriteGate,
	op: string,
	kindOf?: () => string | undefined
): boolean {
	const stamp = gate.stamps.active();
	if (stamp && !stamp.live) {
		assertInvariant('stale-document-write', () => checkDocumentStamp(stamp, op));
		return false;
	}
	if (!isReadOnly(gate.reading)) return true;
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
 * For an undo snapshot pushed ahead of a write: declined wherever the write will be, so no empty
 * entry is left on the stack, and silent, because the write that follows reports itself.
 */
export function admitsSnapshot(gate: WriteGate): boolean {
	return gate.stamps.active()?.live !== false && !isReadOnly(gate.reading);
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
