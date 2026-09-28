// @vitest-environment jsdom
// Bytes dropped into a task item's first paragraph are read the way a reload reads them there:
// after the checkbox, `# ` is paragraph text, as typing it is.
// Miss-analysis: GH #662; the drop's suites dropped into top-level blocks, never a task's slot.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { runDrop, type SelectionDropDeps } from '$lib/selection/selection-drop';
import { makeEditorActionsDeps } from '../harness/editor-actions';
import { fixtureReading } from '../harness/fixture-grammar';

function makeDrop(source: string) {
	const harness = makeEditorActionsDeps(source);
	const controller = createUndoController(harness.deps);
	const deps: SelectionDropDeps = {
		editorRoot: document.createElement('div'),
		getDoc: () => harness.deps.doc,
		controller,
		coordinator: createPasteCoordinator(harness.deps, controller),
		reading: fixtureReading(),
		activePlugins: everyInstalledPlugin,
		events: harness.events,
		setDropCaret: () => {},
		isReadOnly: () => false
	};
	return deps;
}

const item = (doc: { children: readonly CstNode[] }) => doc.children[1].children![0];

describe('a drop at a task item’s text start', () => {
	it.each([
		['copied', true],
		['moved', false]
	])('keeps the checkbox and the paragraph when `# ` is %s there', async (_, copy) => {
		const deps = makeDrop('x# y\n\n- [ ] b\n');

		await runDrop(
			deps,
			{ path: [0], start: 1, end: 3, inCell: false, text: '# ' },
			{ path: [1, 0, 0], offset: 0 },
			copy
		);

		const written = serialize(deps.getDoc());
		expect(written).toMatch(/- \[ \] # b\n$/);
		expect(item(deps.getDoc()).children!.map((c) => c.kind)).toEqual(['paragraph']);
		expect(item(deps.getDoc()).metadata).toMatchObject({ taskItem: true });
		expect(item(parse(written)).children!.map((c) => c.kind)).toEqual(['paragraph']);
	});
});
