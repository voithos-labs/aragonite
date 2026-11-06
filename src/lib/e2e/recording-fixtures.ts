/**
 * The checked-in input recordings and the rule each one follows: the e2e spec replays it, or it
 * says it's only for reading (`diagnosticOnly`). The replay spec and the recordings lint (G4.213)
 * both read this list, so a recording can't sit in the folder run by neither. The checks a replay
 * needs (the hash chain, the key to press, the events to reproduce) live here too.
 */
import { hashSource } from '../core/string-hash';
import { readFileSync } from 'node:fs';
import { collectFiles } from '../test/invariants/lint/scan-source';
import {
	isModifierKeydown,
	readInputRecording,
	type InputRecording,
	type RecordedEvent,
	type RecordedStep,
	type Splice,
	type StepFamily
} from '../debug/input-recording';

export const RECORDINGS_DIR = 'src/lib/e2e/recordings';

/** The step families each engine reproduces through a real input primitive. A browser joins only
 *  after one green run of every recording that names it. */
export const REPLAYABLE: Record<string, readonly StepFamily[]> = {
	chromium: ['pointer', 'key', 'text', 'composition', 'paste']
};

export interface RecordingFixture {
	name: string;
	file: string;
	recording: InputRecording;
}

export function recordingFixtures(): RecordingFixture[] {
	return collectFiles(RECORDINGS_DIR, { extensions: ['.json'] }).map((file) => ({
		name: file.slice(RECORDINGS_DIR.length + 1).replace(/\.json$/, ''),
		file,
		recording: readInputRecording(readFileSync(file, 'utf8'))
	}));
}

export function enginesOf(recording: InputRecording): string[] {
	return recording.diagnosticOnly ? [] : (recording.engines ?? ['chromium']);
}

/** Why the e2e replay can't run this recording, one message per problem; empty when it can. */
export function replayProblems(recording: InputRecording): string[] {
	if (recording.diagnosticOnly) return [];
	const problems = chainBreaks(recording);
	if (!recording.text) problems.push('a recording without text can only be diagnosticOnly');
	for (const engine of enginesOf(recording)) {
		const families = REPLAYABLE[engine];
		if (!families) {
			problems.push(`no replay for ${engine} yet`);
			continue;
		}
		recording.steps.forEach((step, i) => {
			if (!families.includes(step.family)) {
				problems.push(`step ${i}: ${engine} has no primitive for a ${step.family} step`);
			} else if (step.family === 'pointer' && step.before.hash !== step.after.hash) {
				problems.push(`step ${i}: a pointer step that changes bytes needs a real click`);
			} else if (step.family === 'key' && pressedKeydown(step)?.key === undefined) {
				problems.push(`step ${i}: a key step with no key to press`);
			}
		});
	}
	return problems;
}

// ── Checking a recording ────────────────────────────────────────────────────

/** Every way the recording fails to chain (a `before` that isn't the previous `after`, a splice
 *  that doesn't rebuild its hash, a step `expected` misses); empty when it holds together. */
export function chainBreaks(recording: InputRecording): string[] {
	const breaks: string[] = [];
	let hash = recording.initial.hash;
	let source = recording.text ? recording.initial.source : undefined;
	recording.steps.forEach((step, i) => {
		if (step.before.hash !== hash) breaks.push(`step ${i}: before.hash is not the previous hash`);
		if (source !== undefined) {
			source = applySplice(source, step.after.splice);
			if (hashSource(source) !== step.after.hash) {
				breaks.push(`step ${i}: the splice does not rebuild after.hash`);
			}
		}
		hash = step.after.hash;
	});
	if (recording.expected.length !== recording.steps.length) {
		breaks.push(
			`expected has ${recording.expected.length} entries for ${recording.steps.length} steps`
		);
	}
	return breaks;
}

function applySplice(source: string, [from, to, insert]: Splice): string {
	if (typeof insert !== 'string') throw new Error('a splice without text cannot be applied');
	return source.slice(0, from) + insert + source.slice(to);
}

/** The keydown a replay presses: the step's last one that isn't a modifier or an IME's 229. */
export function pressedKeydown(step: RecordedStep): RecordedEvent | undefined {
	return step.events.findLast(
		(e) => e.type === 'keydown' && !isModifierKeydown(e) && e.keyCode !== 229
	);
}

/**
 * The part of a step's events a faithful replay reproduces: types, input types and trust. Key-ups,
 * pointer events and selections vary by driver; an `input` follows only an unprevented beforeinput.
 */
export function eventSignature(step: RecordedStep): string[] {
	return step.events
		.filter((e) => !IGNORED_IN_SIGNATURE.has(e.type))
		.filter((e) => !(step.family === 'text' && e.type === 'keydown' && e.keyCode === 229))
		.map((e) => e.type + (e.inputType ? `:${e.inputType}` : '') + (e.trusted ? '' : '!untrusted'));
}

const IGNORED_IN_SIGNATURE = new Set([
	'keyup',
	'pointerdown',
	'pointerup',
	'selectionchange',
	'input'
]);
