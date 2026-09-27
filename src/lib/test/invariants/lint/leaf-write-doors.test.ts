/**
 * New text for a leaf is written one way at every depth (G4.75). Each row names one step of that
 * write and the files allowed to call it, so a new route calls the shared writer instead of
 * assembling its own copy. The content version and the join have their own scans
 * (`content-version-doors.test.ts`, `cross-node-join-doors.test.ts`).
 */

import { collectEditorSources } from './scan-source';
import { describeFileRules, type FileRule } from './file-rule';

const CONTENT_WRITE = 'src/lib/tree-operations/content-write.ts';
const NODE_PRIMITIVES = 'src/lib/tree-operations/node-primitives.ts';
const BLOCK_EDIT_CORE = 'src/lib/editor-actions/block-edit-core.ts';
const LEAF_WRITE = 'src/lib/editor-actions/leaf-write.ts';

const RULES: FileRule[] = [
	{
		id: 'G4.75 new text for a leaf goes through the content write’s declared callers',
		matches: /\bupdateNodeContent\s*\(/,
		allowed: {
			[CONTENT_WRITE]: 'defines it',
			[BLOCK_EDIT_CORE]:
				'`commitLeafText`, the commit every depth and every path-held writer shares',
			[LEAF_WRITE]: '`writeLeafInPlace`, the keystroke written in place at every depth',
			'src/lib/editor-actions/replacement-focus.ts':
				'the keystroke’s trial reparse, on a copy that is never installed',
			'src/lib/tree-operations/paste/container-match.ts':
				'the matching paste’s merged leaf and its residue, written inside the paste’s own commit'
		},
		reason:
			'a leaf’s new text is written by `commitLeafText` or the in-place keystroke write; call one of them rather than the content write',
		hits: ['const settled = updateNodeContent(body, i, write, grammar, sharing);'],
		misses: [
			"import { updateNodeContent } from './content-write';",
			'scope.updateNodeContentLater(i);'
		]
	},
	{
		id: 'G4.75 a leaf’s bytes are written in place only by the declared routes',
		matches: /\b(?:writeOwnRaw|installOwnRaw)\s*\(/,
		allowed: {
			[NODE_PRIMITIVES]: 'defines both; `writeOwnRaw` runs the kind’s rule, then installs',
			[CONTENT_WRITE]: 'the content write, for a kind with no parse of its own',
			'src/lib/editor-actions/search-replace.ts':
				'find and replace writes bytes `legalizeWrite` returned into a private copy it reparses whole',
			'src/lib/editor-actions/table-context.ts':
				'a pasted grid’s cells: a cell has no reparse and no separators, so the content write would do the same',
			'src/lib/selection/selection-drop.ts': 'a cell cut by a drag, for the same reason',
			'src/lib/selection/range-delete.ts':
				'the same-block range delete, which runs the container’s rule and then the kind’s itself',
			'src/lib/selection/cross-block/format-range.ts':
				'a format toggle over a range, which runs both rules the same way'
		},
		reason:
			'a write in place skips the reparse, the ids and the undo grouping the content write gives; route new text through `commitLeafText`',
		hits: ['writeOwnRaw(node, text, lineEnding, grammar);', 'installOwnRaw(leaf, legal, grammar);'],
		misses: ['const legal = normalizeOwnRaw(node, raw, lineEnding);', 'rewriteOwnRawLater(node);']
	},
	{
		id: 'G4.75 the document’s body, with no owner and its trailing blank line, is built once',
		matches:
			/get suffix\s*\(\s*\)|\bownerKind\b|\bowner:\s*(?:undefined|scope\.node|view\.node|scopeView\.node)\b/,
		allowed: {
			[NODE_PRIMITIVES]: '`documentBody`, the document as a body'
		},
		reason:
			'a hand-built owner can name the document as a container or drop its trailing blank line; use `documentBody` or the scope’s `body`',
		hits: [
			'const body = { children, owner: undefined, lineEnding };',
			'return { children, get suffix() { return doc.suffix; } };',
			'const kind = parent.ownerKind;',
			'const body = { children, owner: view.node, lineEnding };'
		],
		misses: [
			'const body = documentBody(deps.doc);',
			'const body = { children, owner: node, lineEnding };',
			'const body = { children, owner: scope.nodeAt(i), lineEnding };'
		]
	},
	{
		id: 'G4.75 the task marker is reconciled once per kind of write',
		matches: /\breconcileTaskMetadata\s*\(/,
		allowed: {
			'src/lib/tree-operations/list/reconcile-task.ts': 'defines it',
			[CONTENT_WRITE]: 'the content write',
			'src/lib/tree-operations/node-ops.ts': '`joinIntoLeaf`, the one join into a leaf',
			[BLOCK_EDIT_CORE]: '`replaceBlock`, the one replace write'
		},
		reason:
			'a write that re-kinds a list item’s first block reconciles its task marker inside the content write, the join or the replace; call one of those',
		hits: ['if (owner) reconcileTaskMetadata(owner, i, stood, sharing);'],
		misses: ["import { reconcileTaskMetadata } from './reconcile-task';"]
	},
	{
		id: 'G4.75 a replacement is escaped for its container in the one replace write',
		matches: /\bnormalizeReplacementForBody\s*\(/,
		allowed: {
			'src/lib/tree-operations/paste/body-write.ts': 'defines it',
			[BLOCK_EDIT_CORE]: '`replaceBlock`, the one replace write'
		},
		reason:
			'blocks put into a container go through `replaceBlock` (the paste coordinator’s `replaceBlock` too), which escapes them for the container’s rule',
		hits: ['const { replacement } = normalizeReplacementForBody(owner, nodes, lineEnding);'],
		misses: ['const body = normalizeBodyWrite(owner, raw, lineEnding);']
	},
	{
		id: 'G4.75 one keystroke route opens, joins and pauses the typing batch',
		matches: /\b(?:pushUndoSnapshotDebounced|joinTypingBatch|armUndoPause)\b/,
		allowed: {
			'src/lib/editor-actions/commit/undo-controller.ts': 'defines the typing batch',
			'src/lib/editor-actions/deps.ts': 'declares `joinTypingBatch` on the controller',
			'src/lib/action-contracts.ts': 'declares the batch push and the pause on the controller',
			[LEAF_WRITE]: '`typeInLeaf`, which every depth’s keystroke calls'
		},
		reason:
			'a keystroke’s undo grouping comes from `CommitScope.typeIn`; a second caller of the batch groups one level differently from the rest',
		hits: [
			'controller.pushUndoSnapshotDebounced([0], 0, id);',
			'return controller.joinTypingBatch(() => commit());',
			'deps.controller.armUndoPause();'
		],
		misses: ['controller.pushCommitSnapshot(snapshot);', 'textBatch.armPause();']
	},
	{
		id: 'G4.75 the in-place write checks the depth of the chain it copied',
		matches: /['"]unshared-spine-depth['"]/,
		allowed: {
			[LEAF_WRITE]: '`writeLeafInPlace`, the one in-place write (G1.20)'
		},
		reason:
			'the chain-depth check belongs to the in-place write itself, so a caller never repeats it',
		hits: ["assertInvariant('unshared-spine-depth', () => check(chain, path));"],
		misses: [
			"assertInvariant('unshared-spine', () => check());",
			'// the unshared-spine-depth check runs in the write'
		]
	}
];

describeFileRules(RULES, collectEditorSources());
