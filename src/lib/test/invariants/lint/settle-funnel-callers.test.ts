/**
 * The tail rule (GH #168) lives in the splice settle, which the bare tree-op primitives no longer
 * run themselves: `splitNode`, `deleteNode` and the merge doors mutate and report, and the settle
 * comes from the ceremony around them. Every caller today sits inside a commit mutate, so the
 * funnel always runs — and nothing fails when an out-of-ceremony caller is born, which is the
 * sibling-path shape this census closes.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';

/** The primitives that splice a body without settling it. Keyed on the IMPORT rather than the
 *  call, so an alias (`splitNode as performSplit`) still enrolls its file. */
const BARE_PRIMITIVES = [
	'splitNode',
	'deleteNode',
	'mergeWithPrevious',
	'mergeWithNext',
	'mergeIntoPrevDeepLeaf'
];

const IMPORTS_PRIMITIVE = new RegExp(
	`import\\s*\\{[^}]*\\b(?:${BARE_PRIMITIVES.join('|')})\\b[^}]*\\}\\s*from\\s*'[^']*(?:tree-operations|node-ops)`,
	's'
);

/** The ceremony doors that settle the window afterwards, plus the two settle entries themselves.
 *  The doors are reached on a controller or a scope, so a leading dot is the norm here, not the
 *  tripwire it is in the censuses over bare functions. */
const REACHES_SETTLE =
	/\b(commitStructural|commitMultiScope|commitContainer|settleSeparator|spliceChildrenSettled)\s*\(|\.\s*commit\s*\(/;

/** Each file importing a bare primitive → the ceremony whose settle covers its writes. */
const BARE_PRIMITIVE_CALLERS: Record<string, string> = {
	'src/lib/editor-actions/block-edit-core.ts':
		'every split, merge and delete sits in a scope.commit mutate, whose settle door runs after it',
	'src/lib/editor-actions/list-context.ts': 'the item split runs inside commitMultiScope',
	'src/lib/editor-actions/unwrap-strategies.ts': 'the unwrap merges run inside commitContainer',
	'src/lib/selection/range-delete-table-coverage.ts':
		'the table deletes run inside commitStructural'
};

const importsPrimitive = (file: SourceFile): boolean =>
	!file.relPath.startsWith('src/lib/tree-operations/') &&
	IMPORTS_PRIMITIVE.test(stripComments(file.text));

const reachesSettle = (file: SourceFile): boolean => REACHES_SETTLE.test(stripComments(file.text));

const RULE =
	'a bare splice/merge/delete primitive does not settle its own window: call it inside a commit ' +
	'mutate, or settle through `spliceChildrenSettled`. A caller doing neither leaves the tail ' +
	'rule unrun and the document one folded line short of its own reload';

describe('settle-funnel caller census', () => {
	const sources = collectEditorSources();
	const callers = sources.filter(importsPrimitive);

	it('the files importing a bare primitive are the declared ones', () => {
		expect(
			callers.map((file) => file.relPath).sort(),
			'a new caller of the bare primitives: name the ceremony that settles its window'
		).toEqual(Object.keys(BARE_PRIMITIVE_CALLERS).sort());
	});

	it('every declared caller reaches a settle', () => {
		expect(
			callers.filter((file) => !reachesSettle(file)).map((f) => f.relPath),
			RULE
		).toEqual([]);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	const probe = (text: string) => importsPrimitive({ relPath: 'src/lib/x/p.ts', text, code: '' });

	it('the import matcher survives an alias, a multi-line clause and a deep path', () => {
		expect(probe("import { splitNode as performSplit } from '../tree-operations';")).toBe(true);
		expect(
			probe("import {\n\tdeleteNode,\n\temptyParagraph\n} from '../tree-operations/node-ops';")
		).toBe(true);
		// A same-named action-bundle method is not the primitive, and neither is prose.
		expect(probe('blockEdit.mergeWithNext(index);')).toBe(false);
		expect(probe("import type { MergeResult } from '../tree-operations';")).toBe(false);
	});

	it('the settle matcher sees every ceremony door and the two settle entries', () => {
		const at = (text: string) => reachesSettle({ relPath: 'x', text, code: '' });
		expect(at('await scope.commit({ mutate: (view) => {} });')).toBe(true);
		expect(at('await deps.controller.commitMultiScope({});')).toBe(true);
		expect(at('spliceChildrenSettled(parent, at, 1, [node]);')).toBe(true);
		expect(at(stripComments('// commitStructural settles the window'))).toBe(false);
	});

	it('an undeclared caller fails the set equality', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/selection/rogue.ts',
			text: "import { deleteNode } from '../tree-operations';",
			code: ''
		};
		expect(
			[...sources, rogue]
				.filter(importsPrimitive)
				.map((f) => f.relPath)
				.sort()
		).not.toEqual(Object.keys(BARE_PRIMITIVE_CALLERS).sort());
	});
});
