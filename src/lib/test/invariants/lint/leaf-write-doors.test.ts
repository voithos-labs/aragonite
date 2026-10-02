/**
 * New text for a leaf is written one way at every depth (G4.75). Each row names one step of that
 * write and the files allowed to name it (an aliased import counts), so a new route calls the
 * shared writer instead of assembling its own copy. The content version and the join have their own scans
 * (`content-version-doors.test.ts`, `cross-node-join-doors.test.ts`).
 */

import { collectEditorSources } from './scan-source';
import { describeFileRules, type FileRule } from './file-rule';

const CONTENT_WRITE = 'src/lib/tree-operations/content-write.ts';
const NODE_PRIMITIVES = 'src/lib/tree-operations/node-primitives.ts';
const BLOCK_EDIT_CORE = 'src/lib/editor-actions/block-edit-core.ts';
const LEAF_WRITE = 'src/lib/editor-actions/leaf-write.ts';
const TREE_OPS_BARREL = 'src/lib/tree-operations/index.ts';
const BARREL_REASON = 'the tree-operations barrel re-exports it';

/** The writers into a child slot that run their write inside `writeKeepingTaskMarker`. */
const MARKER_WRAPPED: Record<string, string> = {
	[CONTENT_WRITE]: 'the content write, and `rewriteLeafInPlace` for a write that moves no block',
	'src/lib/tree-operations/node-ops.ts': '`joinIntoLeaf`, the one join into a leaf',
	[BLOCK_EDIT_CORE]: '`replaceBlock`, the one replace write',
	'src/lib/selection/range-delete-ceremony.ts':
		'`installSurvivor`, the one install of what a range delete leaves at a block'
};

/** In-place writers whose bytes no list item's first slot can hold, each with why. */
const MARKER_EXEMPT: Record<string, string> = {
	'src/lib/editor-actions/table-context.ts': 'a pasted grid’s cells, and a cell holds no list item',
	'src/lib/selection/selection-drop.ts':
		'a table cell cut by a drag, and a cell holds no list item',
	'src/lib/editor-actions/search-replace.ts':
		'writes into a private copy of a whole top-level block and reparses it whole; the replace reconciles',
	'src/lib/testing/kind-conformance.ts':
		'the published kit writes a kind’s own raw into a throwaway parse, never into a document’s list item'
};

const RULES: FileRule[] = [
	{
		id: 'G4.75 new text for a leaf goes through the content write’s declared callers',
		matches: /\bupdateNodeContent\b/,
		allowed: {
			[CONTENT_WRITE]: 'defines it',
			[TREE_OPS_BARREL]: BARREL_REASON,
			[BLOCK_EDIT_CORE]:
				'`commitLeafText`, the commit every depth and every path-held writer shares',
			[LEAF_WRITE]: '`writeLeafInPlace`, the keystroke written in place at every depth',
			'src/lib/editor-actions/replacement-focus.ts':
				'the keystroke’s trial reparse, on a copy that is never installed',
			'src/lib/tree-operations/paste/container-match.ts':
				'the container-matching paste’s merged leaf and its residue, written inside the paste’s own commit'
		},
		reason:
			'a leaf’s new text is written by `commitLeafText` or the in-place keystroke write; call one of them rather than the content write',
		hits: [
			'const settled = updateNodeContent(body, i, write, grammar, sharing);',
			"import { updateNodeContent as writeContent } from '../tree-operations';",
			'const write = updateNodeContent;\nwrite(body, i, legal, grammar, sharing);'
		],
		misses: ['scope.updateNodeContentLater(i);', '// updateNodeContent would be the wrong call']
	},
	{
		id: 'G4.75 a leaf’s bytes are written in place only by the declared routes',
		matches: /\b(?:writeOwnRaw|installOwnRaw)\b/,
		allowed: {
			[NODE_PRIMITIVES]: 'defines both; `writeOwnRaw` runs the kind’s rule, then installs',
			[CONTENT_WRITE]:
				'the content write for a kind with no parse of its own, and `rewriteLeafInPlace`, which moves no block',
			'src/lib/editor-actions/search-replace.ts':
				'find and replace writes bytes `legalizeWrite` returned into a private copy it reparses whole',
			'src/lib/editor-actions/table-context.ts':
				'a pasted grid’s cells: a cell has no reparse and no separators, so the content write would do the same',
			'src/lib/selection/selection-drop.ts': 'a cell cut by a drag, for the same reason',
			'src/lib/testing/kind-conformance.ts':
				'the raw-write cell lands bytes that already crossed the kind’s rule, in a throwaway parse'
		},
		reason:
			'a write in place skips the reparse, the ids and the undo grouping the content write gives; route new text through `commitLeafText`',
		hits: [
			'writeOwnRaw(node, text, lineEnding, grammar);',
			'installOwnRaw(leaf, legal, grammar);',
			"import { installOwnRaw as put } from '../tree-operations/node-primitives';",
			'const write = writeOwnRaw;\nwrite(node, text, lineEnding, grammar);'
		],
		misses: ['const legal = normalizeOwnRaw(node, raw, lineEnding);', 'rewriteOwnRawLater(node);']
	},
	{
		id: 'G4.75 the document’s body, with no owner and its trailing blank line, is built once',
		matches:
			/get suffix\s*\(\s*\)|\bownerKind\b|\bowner:\s*(?:undefined|void|scope\.node|view\.node|scopeView\.node)\b|\bowner:[^,;{}]*\?\s*(?:undefined\b|[^,;{}]*:\s*undefined\b)/,
		allowed: {
			[NODE_PRIMITIVES]: '`documentBody`, the document as a body'
		},
		reason:
			'a hand-built owner can name the document as a container or drop its trailing blank line; use `documentBody` or the scope’s `body`',
		hits: [
			'const body = { children, owner: undefined, lineEnding };',
			'return { children, get suffix() { return doc.suffix; } };',
			'const kind = parent.ownerKind;',
			'const body = { children, owner: view.node, lineEnding };',
			'const body = { children, owner: void 0, lineEnding };',
			'const body = { children, owner: nested ? node : undefined, lineEnding };',
			'const body = {\n\tchildren,\n\towner: atRoot\n\t\t? undefined\n\t\t: node,\n\tlineEnding\n};'
		],
		misses: [
			'const body = documentBody(deps.doc);',
			'const body = { children, owner: node, lineEnding };',
			'const body = { children, owner: scope.nodeAt(i), lineEnding };',
			'function write(owner: NodeView | undefined, i: number): void {}',
			'interface Body { owner: CstNode | undefined; lineEnding: LineEnding }',
			'const body = { children, owner: ownerCopy, suffix };'
		]
	},
	{
		id: 'G4.82 the task marker is reconciled only inside writeKeepingTaskMarker',
		matches: /\breconcileTaskMetadata\b/,
		allowed: {
			'src/lib/tree-operations/list/reconcile-task.ts':
				'defines it, and `writeKeepingTaskMarker` beside it is its one caller'
		},
		reason:
			'a write into a list item’s first slot wraps itself in `writeKeepingTaskMarker`; a hand-written reconcile is the copy the next route forgets (G1.42)',
		hits: [
			'if (owner) reconcileTaskMetadata(owner, i, stood, sharing);',
			"import { reconcileTaskMetadata as reconcile } from '../tree-operations';"
		],
		misses: ['reconcileTaskMetadataLater(owner);']
	},
	{
		id: 'G4.82b every write into a list item’s first slot keeps the task marker or says why not',
		matches: /\b(?:writeKeepingTaskMarker|writeOwnRaw|installOwnRaw)\b/,
		allowed: {
			'src/lib/tree-operations/list/reconcile-task.ts': 'defines the marker wrapper',
			[NODE_PRIMITIVES]: 'defines the in-place writes the wrapped routes call',
			[TREE_OPS_BARREL]: BARREL_REASON,
			...MARKER_WRAPPED,
			...MARKER_EXEMPT
		},
		reason:
			'a write into a list item’s first slot reconciles its checkbox through `writeKeepingTaskMarker`; a new writer wraps its write in it or joins the exempt list with why no list item can hold its bytes',
		hits: [
			"import { writeKeepingTaskMarker as keep } from '../tree-operations';",
			'writeOwnRaw(node, text, lineEnding, grammar);'
		],
		misses: ['writeKeepingTaskMarkerLater(owner);']
	},
	{
		id: 'G4.82b each writer declared as keeping the marker calls the wrapper',
		population: (file) => file.relPath in MARKER_WRAPPED,
		matches: (file) => !/\bwriteKeepingTaskMarker\s*\(/.test(file.code),
		reason: 'a writer the census counts as keeping the task marker has to run its write inside it',
		reaches: Object.keys(MARKER_WRAPPED),
		hits: [
			{ relPath: CONTENT_WRITE, code: 'writeAndSettleContent(parent, i, legal, grammar, sharing);' }
		],
		misses: [
			{
				relPath: CONTENT_WRITE,
				code: 'writeKeepingTaskMarker(owner, children, i, sharing, () => write());'
			}
		]
	},
	{
		id: 'G4.75 a replacement is escaped for its container in the one replace write',
		matches: /\bnormalizeReplacementForBody\b/,
		allowed: {
			'src/lib/tree-operations/paste/body-write.ts': 'defines it',
			[BLOCK_EDIT_CORE]: '`replaceBlock`, the one replace write'
		},
		reason:
			'blocks put into a container go through `replaceBlock` (the paste coordinator’s `replaceBlock` too), which escapes them for the container’s rule',
		hits: [
			'const { replacement } = normalizeReplacementForBody(owner, nodes, lineEnding);',
			"import { normalizeReplacementForBody as escape } from './paste/body-write';"
		],
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
