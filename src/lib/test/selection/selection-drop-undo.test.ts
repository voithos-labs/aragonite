// @vitest-environment jsdom
// A selection moved between blocks is one undo entry holding the document and the dragged range's
// start as they stood before the drop, and a move that writes nothing leaves none.
// Miss-analysis: GH #30; the drop's units covered coordinate math only, never the writes or entry.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import type { PasteCommitCoordinator } from '$lib/tree-operations/paste/paste-deps';
import { runDrop, type DragSource, type SelectionDropDeps } from '$lib/selection/selection-drop';
import { makeEditorActionsDeps } from '../harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';

const SOURCE = 'alpha beta\n\ngamma\n';
const FROM: DragSource = { path: [0], start: 6, end: 10, inCell: false, text: 'beta' };
const TO = { path: [1], offset: 0 };

/** `declined` writes resolve without committing, as a refused or rolled-back commit does. */
function makeDrop(declined = 0) {
	const harness = makeEditorActionsDeps(SOURCE);
	const controller = createUndoController(harness.deps);
	const real = createPasteCoordinator(harness.deps, controller);
	let calls = 0;
	const coordinator: PasteCommitCoordinator = {
		...real,
		replaceBlock: (...args) =>
			calls++ < declined ? Promise.resolve(null) : real.replaceBlock(...args)
	};
	const deps: SelectionDropDeps = {
		editorRoot: document.createElement('div'),
		getDoc: () => harness.deps.doc,
		controller,
		coordinator,
		reading: fixtureReading(),
		activePlugins: everyInstalledPlugin,
		events: harness.events,
		setDropCaret: () => {},
		isReadOnly: () => false
	};
	return { deps, undo: () => harness.deps.undoManager.getStacks().undo };
}

describe('dropping a selection into another block', () => {
	it('is one undo entry holding the bytes and the range start from before the drop', async () => {
		const { deps, undo } = makeDrop();

		await runDrop(deps, FROM, TO, false);

		expect(serialize(deps.getDoc())).toBe('alpha \n\nbetagamma\n');
		expect(undo()).toHaveLength(1);
		expect(serialize(undo()[0].snapshot)).toBe(SOURCE);
		const start = { path: [0], offset: 6 };
		expect(undo()[0].selection).toEqual({ anchor: start, focus: start });
	});

	it('leaves no undo entry when neither write lands', async () => {
		const { deps, undo } = makeDrop(Infinity);

		await runDrop(deps, FROM, TO, false);

		expect(serialize(deps.getDoc())).toBe(SOURCE);
		expect(undo()).toHaveLength(0);
	});

	// Miss-analysis: the case above declined both writes, and none let the insert land alone.
	it('inserts nothing when the cut does not land, so a move never becomes a copy', async () => {
		const { deps, undo } = makeDrop(1);

		await runDrop(deps, FROM, TO, false);

		expect(serialize(deps.getDoc())).toBe(SOURCE);
		expect(undo()).toHaveLength(0);
	});
});
