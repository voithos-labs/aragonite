/**
 * The input recording format and the pure work over it: the step classifier, the source hash,
 * the splices that chain one step's bytes to the next, and the reader. No DOM and no Svelte, so
 * the e2e replayer can import it in Node. Field reference:
 * `docs/guide/consumer-guide/shipping.md` § Recording input.
 */

import type { EditorSelection } from '../selection/primitives';

export const INPUT_RECORDING_FORMAT = 'aragonite-input-recording/1';

/** What a step was, which decides how a replay reproduces it. */
export type StepFamily =
	'key' | 'text' | 'rewrite' | 'composition' | 'paste' | 'drop' | 'pointer' | 'history';

/** Text the recording holds only when it was made with `includeText`; otherwise its length. */
export type MaybeText = string | number;

/** A replacement of `from..to` in the previous source by the inserted text (or its length). */
export type Splice = [from: number, to: number, insert: MaybeText];

export interface RecordedState {
	/** The editor's content version, which goes up on every byte write. */
	version: number;
	hash: string;
	selection: EditorSelection | null;
}

export interface RecordedAfter extends RecordedState {
	splice: Splice;
}

export interface RecordedRange {
	/** Both ends as block path and raw offset, or null where an end sits outside any block. */
	raw: [number[], number, number[], number] | null;
	/** Both ends as text offsets into the editable element the event targets. */
	dom: [number, number];
}

export interface RecordedEvent {
	type: string;
	/** Milliseconds since the previous event, or since the recording started. */
	dt: number;
	trusted: boolean;
	/** Named keys always; a printable key, and any `code`, only with text or under Ctrl or Cmd. */
	key?: string;
	code?: string;
	keyCode?: number;
	/** Held modifiers as letters: C (Ctrl), M (Meta), A (Alt), S (Shift). */
	mods?: string;
	repeat?: boolean;
	isComposing?: boolean;
	inputType?: string;
	data?: MaybeText | null;
	targetRanges?: RecordedRange[];
	dom?: { text?: string; sel: [number, number] | null };
	/** Whether a handler prevented the event's default, read when the step closed. */
	verdict?: boolean;
	clipboard?: Record<string, MaybeText>;
	pointerType?: string;
}

export interface RecordedStep {
	family: StepFamily;
	before: RecordedState;
	after: RecordedAfter;
	events: RecordedEvent[];
}

export interface ExpectedState {
	hash: string;
	selection: EditorSelection | null;
}

export interface RecordingEnvironment {
	userAgent: string;
	uaData: { platform: string; mobile: boolean; brands: string[] } | null;
	/** Where the input came from (`playwright-cdp`, `gboard`, ...), if whoever saved it says. */
	inputMethod?: string;
	pointer: 'fine' | 'coarse' | 'none';
	viewport: [number, number];
	dpr: number;
}

export interface InputRecording {
	format: typeof INPUT_RECORDING_FORMAT;
	editor: { version: string; presentationMode: string; caret: string };
	/** Whether typed characters, key codes, event data, clipboard and DOM text were kept. */
	text: boolean;
	env: RecordingEnvironment;
	/** Every hash is salted per recording without text, so it compares only within the file. */
	initial: { source?: string; hash: string; selection: EditorSelection | null };
	/** What happened. Never rewritten once recorded. */
	steps: RecordedStep[];
	/** What each step should leave: a copy of `steps[].after` at first, hand-edited for a bug. */
	expected: ExpectedState[];
	/** A checked-in recording no replay runs, kept only to read. */
	diagnosticOnly?: boolean;
	/** The browsers a checked-in recording replays in; Chromium when absent. */
	engines?: string[];
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** Parses a recording, refusing anything not in the one format this build reads. */
export function readInputRecording(json: string | unknown): InputRecording {
	const value = typeof json === 'string' ? (JSON.parse(json) as unknown) : json;
	const format = (value as { format?: unknown } | null)?.format;
	if (format === INPUT_RECORDING_FORMAT) return value as InputRecording;
	if (typeof format === 'string' && format.startsWith('aragonite-input-recording/')) {
		throw new Error(
			`This recording is ${format}, and this aragonite reads only ${INPUT_RECORDING_FORMAT}.`
		);
	}
	throw new Error('Not an aragonite input recording: it has no recognised format field.');
}

// ── Steps ───────────────────────────────────────────────────────────────────

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

export function isModifierKeydown(event: RecordedEvent): boolean {
	return event.type === 'keydown' && event.key !== undefined && MODIFIER_KEYS.has(event.key);
}

export function classifyStep(opener: string, events: readonly RecordedEvent[]): StepFamily {
	const has = (type: string) => events.some((e) => e.type === type);
	if (has('compositionstart')) return 'composition';
	if (has('paste')) return 'paste';
	if (has('drop')) return 'drop';
	if (opener === 'pointerdown') return 'pointer';
	const inputs = events.filter((e) => e.type === 'beforeinput');
	const typedKey = events.some(
		(e) => e.type === 'keydown' && e.keyCode !== 229 && !isModifierKeydown(e)
	);
	if (typedKey) return 'key';
	if (inputs.some((e) => e.inputType === 'historyUndo' || e.inputType === 'historyRedo')) {
		return 'history';
	}
	// No real keydown: a soft keyboard, dictation or an emoji panel wrote it.
	if (inputs.length > 0 && inputs.every((e) => e.inputType === 'insertText')) return 'text';
	return inputs.length > 0 ? 'rewrite' : 'key';
}

// ── Bytes ───────────────────────────────────────────────────────────────────

/** The one replacement that turns `before` into `after`: common prefix and suffix trimmed. */
export function spliceBetween(before: string, after: string): [number, number, string] {
	let start = 0;
	const limit = Math.min(before.length, after.length);
	while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
	let tail = 0;
	while (
		tail < limit - start &&
		before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
	) {
		tail++;
	}
	return [start, before.length - tail, after.slice(start, after.length - tail)];
}
