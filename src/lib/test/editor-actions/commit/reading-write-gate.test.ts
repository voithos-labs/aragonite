// Every entry point that writes document bytes asks the reading-mode check before writing: under
// the warn policy a reading-mode write lands and reports itself, under refuse it is declined with
// no undo entry and no edit event. One row per byte-writing entry point.
// Miss-analysis: no writer read the mode, so each route relied on its own caller's check, and no
// test drove a writer in reading mode to see whether anything stopped it.
import { afterEach, describe, expect, it } from 'vitest';
import { CENSUS_WARN_TAGS } from '$lib/dev-warn';
import { serialize } from '$lib/core/serializer';
import type { EditEvent } from '$lib/editor-events';
import type { EditorActionsDeps } from '$lib/editor-actions/deps';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import {
	READING_WRITE_TAG,
	__setReadingWritePolicyForTests,
	type ReadingWritePolicy
} from '$lib/editor-actions/commit/reading-write-gate';
import type { PresentationMode } from '$lib/presentation-mode';
import { fixtureReading } from '../../harness/fixture-grammar';
import { makeNestedHarness, makeTopHarness } from '../../harness/editor-actions';
import { takeDevWarns } from '../../support/warn-gate';

interface Writer {
	deps: EditorActionsDeps;
	edits: EditEvent[];
	write(): void | Promise<void>;
}

interface WriterRow {
	name: string;
	op: string;
	/** Builds the editor in source mode, then switches it to `mode` before the write. */
	setup(mode: PresentationMode): Promise<Writer>;
}

function recordEdits(deps: EditorActionsDeps): EditEvent[] {
	const edits: EditEvent[] = [];
	deps.events.on('edit', (e) => edits.push(e));
	return edits;
}

const WRITERS: WriterRow[] = [
	{
		name: 'a structural commit at the document root',
		op: 'split',
		async setup(mode) {
			const h = makeTopHarness('one\n\ntwo\n', { reading: fixtureReading({}, mode) });
			return { deps: h.deps, edits: h.edits, write: () => h.actions.splitBlock(0, 1) };
		}
	},
	{
		name: 'a container commit',
		op: 'split',
		async setup(mode) {
			const h = makeNestedHarness('> quoted\n', { index: 0, presentationMode: mode });
			return {
				deps: h.deps,
				edits: recordEdits(h.deps),
				write: () => h.bundle.blockEdit.splitBlock(0, 3)
			};
		}
	},
	{
		name: 'a keystroke at the document root',
		op: 'updateContent',
		async setup(mode) {
			const h = makeTopHarness('one\n', { reading: fixtureReading({}, mode) });
			return {
				deps: h.deps,
				edits: h.edits,
				write: () => h.actions.updateBlockContent(0, 'onex\n', 3, 4)
			};
		}
	},
	{
		name: 'a keystroke inside a container',
		op: 'updateContent',
		async setup(mode) {
			const h = makeNestedHarness('> quoted\n', { index: 0, presentationMode: mode });
			return {
				deps: h.deps,
				edits: recordEdits(h.deps),
				write: () => h.bundle.blockEdit.updateBlockContent(0, 'quotedx\n', 6, 7)
			};
		}
	},
	{
		name: 'an undo',
		op: 'undo',
		async setup(mode) {
			let current: PresentationMode = 'source';
			const h = makeTopHarness('one\n\ntwo\n', {
				reading: fixtureReading({ mode: () => current })
			});
			const history = createHistoryActions(h.deps, h.controller);
			await h.actions.deleteBlock(1);
			h.edits.length = 0;
			current = mode;
			return { deps: h.deps, edits: h.edits, write: () => history.requestUndo() };
		}
	}
];

let restorePolicy: ReadingWritePolicy | null = null;

function usePolicy(next: ReadingWritePolicy): void {
	const previous = __setReadingWritePolicyForTests(next);
	restorePolicy ??= previous;
}

afterEach(() => {
	if (restorePolicy) __setReadingWritePolicyForTests(restorePolicy);
	restorePolicy = null;
});

function readingWrites(): string[] {
	return takeDevWarns()
		.filter((w) => w.tag === READING_WRITE_TAG)
		.map((w) => w.message.split(',')[0]);
}

describe('the reading-mode check at every byte-writing entry point', () => {
	for (const row of WRITERS) {
		it(`${row.name}: writes and reports itself in reading mode under the warn policy`, async () => {
			usePolicy('warn');
			const writer = await row.setup('reading');
			const before = serialize(writer.deps.doc);
			await writer.write();
			expect(serialize(writer.deps.doc)).not.toBe(before);
			expect(readingWrites()).toEqual([`wrote '${row.op}' in reading mode`]);
		});

		it(`${row.name}: is declined in reading mode under the refuse policy`, async () => {
			usePolicy('refuse');
			const writer = await row.setup('reading');
			const before = serialize(writer.deps.doc);
			const stacks = writer.deps.undoManager.getStacks();
			await writer.write();
			expect(serialize(writer.deps.doc)).toBe(before);
			expect(writer.deps.undoManager.getStacks()).toEqual(stacks);
			expect(writer.edits).toEqual([]);
			expect(readingWrites()).toEqual([`declined '${row.op}' in reading mode`]);
		});

		it(`${row.name}: writes without a report in source mode under the refuse policy`, async () => {
			usePolicy('refuse');
			const writer = await row.setup('source');
			const before = serialize(writer.deps.doc);
			await writer.write();
			expect(serialize(writer.deps.doc)).not.toBe(before);
			expect(readingWrites()).toEqual([]);
		});
	}

	it('the report is a census tag, which the warning watchers print and never fail on', () => {
		expect(CENSUS_WARN_TAGS).toContain(READING_WRITE_TAG);
	});
});
