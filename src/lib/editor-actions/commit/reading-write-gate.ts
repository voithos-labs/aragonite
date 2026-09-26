/**
 * Reading mode writes no bytes, and every entry point that writes the document asks here first.
 * Under the 'warn' policy a reading-mode write still lands and reports its operation and caller,
 * so every such write can be listed before the editor starts refusing them; under 'refuse' it is
 * declined and reported the same way. Ask synchronously, before the first await, or the report
 * loses the caller.
 */

import { splitLines } from '../../core/lines';
import { devWarn } from '../../dev-warn';
import { editorEnv } from '../../env';
import { isReadingMode } from '../../presentation-mode';
import type { Reading } from '../../schema/reading';

export type ReadingWritePolicy = 'warn' | 'refuse';

export const READING_WRITE_TAG = 'reading-write';

// TODO(#493): switch to 'refuse' once every reading-mode write the suites report is accounted for.
let policy: ReadingWritePolicy = 'warn';

// ── Public API ──────────────────────────────────────────────────────────────

/** Whether a write naming `op` may land. A reading-mode write warns either way. */
export function admitsWrite(reading: Reading, op: string): boolean {
	if (!isReadOnly(reading)) return true;
	const refused = policy === 'refuse';
	if (editorEnv.isDev) {
		const verdict = refused ? 'declined' : 'wrote';
		devWarn(
			READING_WRITE_TAG,
			`${verdict} '${op}' in reading mode, called from ${callerOf(new Error().stack)}`
		);
	}
	return !refused;
}

/**
 * For an undo snapshot pushed ahead of a write: declined under 'refuse' so no empty entry is
 * left on the stack, and silent, because the write that follows reports itself.
 */
export function admitsSnapshot(reading: Reading): boolean {
	return policy !== 'refuse' || !isReadOnly(reading);
}

/** Swap the policy for one test and return the one it replaced; restore it afterwards. */
export function __setReadingWritePolicyForTests(next: ReadingWritePolicy): ReadingWritePolicy {
	const previous = policy;
	policy = next;
	return previous;
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
