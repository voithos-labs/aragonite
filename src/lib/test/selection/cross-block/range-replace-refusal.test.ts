// @vitest-environment jsdom
// The range replace is the one write-level refusal for range gestures: reading mode refuses a keyed
// gesture with the dev warning and a cut or paste quietly, a `source` swap refuses quietly, and text
// whose paragraph can't open where the range was is dropped with a warning.
// Miss-analysis: each route carried its own reading-mode check, so no test drove the replace alone.
import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { READING_WRITE_TAG } from '#lib/editor-actions/commit/reading-write-gate.js';
import { stampWrites } from '#lib/editor-actions/commit/document-stamp.js';
import { replaceRange, type RangeInsertion } from '#lib/selection/cross-block/range-replace.js';
import { makeEditorActionsDeps, stubBlockComponent } from '#lib/test/harness/editor-actions.js';
import { fixtureReading } from '../../harness/fixture-grammar';
import { takeDevWarns, takeDevWarnsOf } from '../../support/warn-gate';
import { rangeContext } from './range-context';

const SOURCE = 'alpha\n\nbeta\n';

function makeRange(mode: 'source' | 'reading') {
	const { deps } = makeEditorActionsDeps(SOURCE, { reading: fixtureReading({}, mode) });
	const controller = createUndoController(deps);
	deps.selectionState.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 2 });
	return { deps, controller };
}

const readingWarns = () => takeDevWarnsOf(READING_WRITE_TAG).length;

const GESTURES: [name: string, insertion: RangeInsertion, warns: boolean][] = [
	['Backspace', { kind: 'none', gesture: 'Backspace' }, true],
	['a typed character', { kind: 'text', text: 'x' }, true],
	['Enter', { kind: 'command', chord: 'Enter' }, true],
	['a composition', { kind: 'composition' }, true],
	['a cut', { kind: 'none', gesture: 'cut' }, false],
	['a paste', { kind: 'paste', text: 'P' }, false]
];

describe('the range replace in reading mode', () => {
	for (const [name, insertion, warns] of GESTURES) {
		it(`refuses ${name}${warns ? ', with the warning' : ' quietly'}`, async () => {
			const { deps, controller } = makeRange('reading');

			expect(await replaceRange(rangeContext(deps, controller), insertion)).toBe('refused');

			expect(serialize(deps.doc)).toBe(SOURCE);
			expect(deps.undoManager.getStacks().undo).toEqual([]);
			expect(deps.selectionState.ownsRange).toBe(true);
			expect(readingWarns()).toBe(warns ? 1 : 0);
		});
	}
});

// The typed half runs after the removal, so a swap can land between them; the block's typing write
// then refuses, and the replace says so. Miss-analysis: the caller dropped the write's answer.
describe('a character typed over a range whose block refuses the typing write', () => {
	it('is reported refused', async () => {
		const { deps, controller } = makeRange('source');
		const ctx = rangeContext(deps, controller);
		const refusing = { ...stubBlockComponent(), typeText: async () => false };

		const outcome = await replaceRange(
			{ ...ctx, caretLanding: { ...ctx.caretLanding, mount: async () => refusing } },
			{ kind: 'text', text: 'x' }
		);

		expect(outcome).toBe('refused');
	});
});

describe('a range gesture a `source` swap outran', () => {
	it('is refused quietly, the range left as it was', async () => {
		const { deps, controller } = makeRange('source');
		// The controller a block holds, stamped with the document it mounted on.
		const stamped = stampWrites(controller, deps.stamps.current(), deps.stamps);
		deps.stamps.retire();

		const outcome = await replaceRange(rangeContext(deps, stamped), {
			kind: 'none',
			gesture: 'Backspace'
		});

		expect(outcome).toBe('refused');
		expect(serialize(deps.doc)).toBe(SOURCE);
		expect(takeDevWarns()).toEqual([]);
	});
});

// Miss-analysis: every row over the paragraph a removal opens let it open, so no test saw the
// text written in front of the kept block's syntax when it couldn't.
describe('text over a range whose paragraph where the range was cannot open', () => {
	const KEPT = '| c |\n| - |\n\n# Head\n';
	const TEXT: [name: string, insertion: RangeInsertion][] = [
		['a typed character', { kind: 'text', text: 'x' }],
		['a paste', { kind: 'paste', text: 'x' }]
	];
	for (const [name, insertion] of TEXT) {
		it(`drops ${name} with the warning, never writing it in front of the heading's \`#\``, async () => {
			const { deps } = makeEditorActionsDeps(KEPT);
			const controller = createUndoController(deps);
			deps.selectionState.enterCrossBlock(
				{ path: [0], offset: 0, cellCoordinate: true },
				{ path: [1], offset: 0 }
			);
			const ctx = rangeContext(deps, controller);
			const refusing = { ...ctx.pasteCoordinator, insertParagraph: async () => false };

			const outcome = await replaceRange({ ...ctx, pasteCoordinator: refusing }, insertion);

			expect(serialize(deps.doc)).toBe('# Head\n');
			expect(outcome).toBe('refused');
			expect(takeDevWarns().map((w) => w.tag)).toEqual(['range-replace']);
		});
	}
});
