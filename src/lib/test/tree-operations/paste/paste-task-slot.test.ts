// @vitest-environment jsdom
// Miss-analysis: GH #666; the paste suites split plain paragraphs and plain items, so no paste
// ever left text behind a task checkbox for the reload to read differently.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { CstNode } from '#lib/core/nodes.js';
import { pasteDispatch } from '#lib/tree-operations/paste/dispatch.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createBlockEditActions } from '#lib/editor-actions/block-edit.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { makeEditorActionsDeps, pasteContext } from '../../harness/editor-actions';

// A paste that splits a task item's first paragraph leaves each half in a slot a checkbox stands
// in front of, so each half reads the way a reload reads it there: `# b` stays paragraph text.

/** Kinds and task flags all the way down: what the tree holds and what its reload must match. */
function shape(nodes: readonly CstNode[]): unknown[] {
	return nodes.map((node) => [
		node.kind,
		node.kind === 'listItem' ? (node.metadata as { taskItem: boolean }).taskItem : null,
		shape(node.children ?? [])
	]);
}

async function paste(source: string, offset: number, clipboard: string): Promise<string> {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	await pasteDispatch(
		{ pastedText: clipboard, targetPath: [0, 0, 0], offset },
		pasteContext({
			doc: deps.doc,
			blockEdit: createBlockEditActions(deps, controller),
			controller: createPasteCoordinator(deps, controller)
		})
	);
	const written = serialize(deps.doc);
	expect(shape(deps.doc.children), written).toEqual(shape(parse(written).children));
	return written;
}

describe('a paste into a task item’s first paragraph', () => {
	it('of blocks after `# b` keeps the checkbox and `# b` as the item’s paragraph', async () => {
		expect(await paste('- [ ] # bc\n', 3, 'x\n\ny')).toMatch(/^- \[ \] # b\n/);
	});

	it('of a list after `# b` keeps `# b` as the first item’s paragraph', async () => {
		expect(await paste('- [ ] # bc\n', 3, '- p\n- q')).toBe('- [ ] # b\n- p\n- q\n- [ ] c\n');
	});

	it('of a list before `# c` keeps `# c` on the split-off item’s checkbox line', async () => {
		expect(await paste('- [ ] a # c\n', 2, '- p\n- q')).toBe('- [ ] a \n- p\n- q\n- [ ] # c\n');
	});
});

// Miss-analysis: the rows above all left text before the cut, so no single pasted block landed at
// a to-do's text start, where its re-read with the rest of the line took the to-do's reader.
describe('one block pasted at a to-do’s text start', () => {
	it.each([
		['a heading', '# x', '- # x\n  bc\n'],
		['a quote', '> x', '- > x\n  bc\n']
	])('keeps %s as the clipboard read it, and the tree matches its reload', async (_, clip, out) => {
		expect(await paste('- [ ] bc\n', 0, clip)).toBe(out);
	});
});
