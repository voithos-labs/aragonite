/**
 * Every entry point that writes the document asks here first. A write in reading mode is declined,
 * and a dev build names it; one made for a document a `source` swap replaced, after the editor
 * unmounted, or while an undo or redo installs its entry, is declined quietly. A write started
 * while another is open is refused out loud: the `error` event hears it and a dev build throws.
 * Ask synchronously, before the first await, or the report loses the caller and the write's stamp.
 */

import { splitLines } from '../../core/lines';
import { devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import { emitCommitError, type EditorEvents } from '../../editor-events';
import { isReadingMode } from '../../presentation-mode';
import type { Reading } from '../../schema/reading';
import type { OperationKind } from '../../schema/operations';
import type { DocumentStamps } from './document-stamp';
import type { KeptStarts } from './kept-starts';

export const READING_WRITE_TAG = 'reading-write';

// ── Public API ──────────────────────────────────────────────────────────────

/** What the gate reads: the mode, and the document the write being made was stamped with. */
export interface WriteGate {
	readonly reading: Reading;
	readonly stamps: DocumentStamps;
}

/** What an entry point that opens a write window reads besides: whether a write is open now,
 *  and the channel a write refused for it, or failed, is reported on. */
export interface OpenWriteCheck {
	readonly starts: Pick<KeptStarts, 'writing'>;
	readonly events: Pick<EditorEvents, 'emit'>;
}

/** The op a failed write names on the `error` event. */
interface FailedOp {
	kind: OperationKind;
	eventPath?: number[];
}

/** Whether a write may start: false while another is open, whose publish would overwrite it, and
 *  then refused through `failWrite`. Ask before the write's first side effect. */
export function startsAlone(door: OpenWriteCheck, op?: FailedOp): boolean {
	if (!door.starts.writing()) return true;
	failWrite(door, new Error('aragonite: a write started inside another write'), op);
	return false;
}

/** The one way a write fails: the `error` event hears it and a dev build throws, so the code that
 *  started the write sees it. In production the caller answers as a refused write does. */
export function failWrite(
	door: Pick<OpenWriteCheck, 'events'>,
	error: unknown,
	op?: FailedOp
): void {
	emitCommitError(door.events, { error, op: op?.kind, path: op?.eventPath });
	if (devChecksOn) throw error;
}

/** Whether a write naming `op` may land: quietly false for a swapped-out or ended document or
 *  during an undo's install, false in reading mode with a dev warning naming `kindOf`'s kind. */
export function admitsWrite(
	gate: WriteGate,
	op: string,
	kindOf?: () => string | undefined
): boolean {
	return !gate.stamps.historySwapping() && admitsHistoryRequest(gate, op, kindOf);
}

/** The same check for an undo or redo itself, which may start while another's install runs. */
export function admitsHistoryRequest(
	gate: WriteGate,
	op: string,
	kindOf?: () => string | undefined
): boolean {
	if (!madeForLiveDocument(gate)) return false;
	if (!isReadOnly(gate.reading)) return true;
	if (devChecksOn) {
		const kind = kindOf?.();
		const on = kind ? `on a '${kind}' block, ` : '';
		devWarn(
			READING_WRITE_TAG,
			`declined '${op}' in reading mode, ${on}called from ${callerOf(deepStack())}`
		);
	}
	return false;
}

/**
 * For an undo snapshot pushed ahead of a write: declined wherever the write will be, so no empty
 * entry is left on the stack, and silent, because the write that follows reports itself.
 */
export function admitsSnapshot(gate: WriteGate & Pick<OpenWriteCheck, 'starts'>): boolean {
	return (
		!gate.starts.writing() &&
		!gate.stamps.historySwapping() &&
		madeForLiveDocument(gate) &&
		!isReadOnly(gate.reading)
	);
}

// ── Internal ────────────────────────────────────────────────────────────────

// An unstamped write is made for the document in place, which an unmount ends.
function madeForLiveDocument(gate: WriteGate): boolean {
	return (gate.stamps.active() ?? gate.stamps.current()).live;
}

function isReadOnly(reading: Reading): boolean {
	return isReadingMode(() => reading.mode());
}

const FRAME = /^\s*at (?:async )?(?:(.+?) \()?.*?\/src\/lib\/([^\s:?)]+\.(?:ts|svelte))/;

// This module and the commit's files sit between every caller and the check.
const OWN_FILES = new Set([
	'editor-actions/commit/reading-write-gate.ts',
	'editor-actions/commit/undo-controller.ts',
	'editor-actions/commit/structural-commit.ts',
	'editor-actions/commit/commit-frame.ts',
	'editor-actions/commit/byte-splice.ts'
]);

/** A stack deep enough to reach past the write machinery, whose depth the default limit can cut. */
function deepStack(): string | undefined {
	const limit = Error.stackTraceLimit;
	Error.stackTraceLimit = 40;
	const { stack } = new Error();
	Error.stackTraceLimit = limit;
	return stack;
}

/** The nearest five editor files outside the write machinery, innermost first, each named by its
 *  first frame. */
function callerOf(stack: string | undefined): string {
	const frames: string[] = [];
	let file = '';
	for (const { text } of splitLines(stack ?? '')) {
		const match = FRAME.exec(text);
		if (!match || OWN_FILES.has(match[2]) || match[2] === file) continue;
		file = match[2];
		frames.push(match[1] ? `${match[1]} (${match[2]})` : match[2]);
		if (frames.length === 5) break;
	}
	return frames.length > 0 ? frames.join(' < ') : 'an unknown caller';
}
