// @vitest-environment jsdom
// The fixed law cases the clipboard spec drives in a browser, driven here through jsdom's stand-in
// events, against the same bytes; and each known violation's repro, which must still fail until the
// fix that closes it deletes the row.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	RANGE_LAW_CASES,
	type CaseObserved,
	type CaseStep,
	type RangeLawCase
} from '#lib/e2e/range-law-cases.js';
import {
	clipboardGesture,
	deleteGesture,
	mountCase,
	pasteGesture,
	pastePlainGesture,
	placeRange,
	runHistory,
	typeGesture,
	type Editor,
	type Payload,
	Undetermined
} from './gestures';
import { LAW_SPECS } from './law-specs';
import { KNOWN_VIOLATIONS, knownClassOf } from './known-failures';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

/** Drives `row` and reads back what its `expected` names. */
async function observe(row: RangeLawCase): Promise<CaseObserved> {
	const editor = mountCase(row.source, row.mode);
	await editor.settle();
	expect(await placeRange(editor, row.select), 'the range would not place').toBe(true);
	let written: Payload = {};
	for (const step of row.steps) {
		if (step.do === 'copy' || step.do === 'cut') written = await copyOrCut(editor, step);
		else if (step.do === 'paste') {
			await pasteGesture(
				editor,
				step.text === undefined ? written : { 'text/plain': step.text },
				step.route
			);
		} else if (step.do === 'paste plain') await pastePlainGesture(editor, step.text);
		else if (step.do === 'type') await typeGesture(editor, { text: step.text, route: step.route });
		else if (step.do === 'press') {
			const taken =
				step.key === 'Enter'
					? await typeGesture(editor, { key: 'Enter' })
					: await deleteGesture(editor, step.key);
			expect(taken, `${step.key} was left to the browser`).toBe(true);
		} else if (step.do === 'undo') await runHistory(editor, 'undo');
		else throw new Error(`jsdom can't drive ${step.do}`);
	}
	takeDevWarns();
	const seen: CaseObserved = { source: editor.source() };
	if ('clipboard' in row.expected) seen.clipboard = written['text/plain'] ?? '';
	if ('selection' in row.expected)
		seen.selection = editor.instance.getSelection() as CaseObserved['selection'];
	return seen;
}

/** A copy or cut; a menu row the press finds disabled does nothing, as in the browser run. */
async function copyOrCut(
	editor: Editor,
	step: Extract<CaseStep, { do: 'copy' | 'cut' }>
): Promise<Payload> {
	try {
		return await clipboardGesture(editor, step.do, step.route);
	} catch (error) {
		if (error instanceof Undetermined && /disabled/.test(error.message)) return {};
		throw error;
	}
}

describe('the range-law cases, as jsdom drives them', () => {
	for (const row of RANGE_LAW_CASES.filter((r) => !r.only)) {
		it(`${row.law}: ${row.name}${row.issue ? ` (${row.issue})` : ''}`, async () => {
			const seen = await observe(row);
			if (row.today) {
				expect(seen, 'the row now keeps its law: delete its `today`').not.toEqual(row.expected);
				expect(seen).toEqual(row.today);
			} else expect(seen).toEqual(row.expected);
		}, 15_000);
	}
});

describe('each known violation still reproduces', () => {
	for (const row of KNOWN_VIOLATIONS) {
		it(`${row.issue}: ${row.defect}`, async () => {
			const spec = LAW_SPECS.find((s) => s.law === row.repro.law)!;
			const run = await spec.run(row.repro.args);
			expect(
				// The repro must land in its own row, what it keeps and the rows above it included.
				run.lines.filter((line) => knownClassOf(line) === row),
				'the repro no longer fails: if a fix closed the class, delete its row'
			).not.toEqual([]);
		}, 30_000);
	}
});
