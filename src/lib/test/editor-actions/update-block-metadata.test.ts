import { beforeEach, describe, it, expect, vi } from 'vitest';
import { installPlugins, parse, serialize } from '#lib';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { configureEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import type { EditorError } from '#lib/editor-events.js';
import {
	makeNestedHarness,
	makeNode,
	makeTopHarness,
	mountEveryBlock
} from '#lib/test/harness/editor-actions.js';

// rebuildListItemRaw no-ops without `children`, so raw-assertion cases need a child.
function makeTaskListItem(text: string, taskMarker: string): any {
	const checked = taskMarker.trim().toLowerCase() === '[x]';
	return {
		kind: 'listItem',
		leadingTrivia: '',
		raw: `- ${taskMarker}${text}\n`,
		metadata: { marker: '- ', taskItem: true, taskChecked: checked, taskMarker },
		innerPrefix: '',
		innerSuffix: '',
		children: [{ kind: 'paragraph', leadingTrivia: '', raw: `${text}\n` }]
	};
}

// The patch a checkbox toggle commits, which the list item's rebuild writes into its bytes.
const CHECK = { taskChecked: true, taskMarker: '[x] ' };

// ── Top-level scope ───────────────────────────────────────────────────────────

// A top-level container whose rebuild writes its metadata into its bytes.
const ALERT = '> [!NOTE]\n> body\n';
const TIP = { alertType: 'TIP' };

beforeEach(() => {
	installPlugins([admonitionsPlugin()]);
});

describe('updateBlockMetadata', () => {
	it('merges patch into node.metadata and emits one metadataUpdate event', async () => {
		const { doc, events, actions } = makeTopHarness(parse(ALERT).children);
		const node = doc.children[0];

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await actions.updateBlockMetadata(0, TIP);

		// Copy before write: the pre-edit node stays untouched for the snapshot sharing it.
		expect(doc.children[0].metadata).toMatchObject(TIP);
		expect(node.metadata).toMatchObject({ alertType: 'NOTE' });
		expect(serialize(doc)).toBe('> [!TIP]\n> body\n');
		expect(editHandler).toHaveBeenCalledTimes(1);
		const evt = editHandler.mock.calls[0][0];
		expect(evt.op).toBe('metadataUpdate');
		expect(evt.path).toEqual([0]);
		expect(evt.detail.fields).toEqual(['alertType']);
	});

	it('pushes exactly one undo snapshot, and undo/redo flip metadata back and forth', async () => {
		const { deps, controller, actions } = makeTopHarness(parse(ALERT).children);
		const history = createHistoryActions(deps, controller);

		await actions.updateBlockMetadata(0, TIP);

		const stacks = deps.undoManager.getStacks();
		expect(stacks.undo).toHaveLength(1);
		expect(stacks.undo[0].snapshot.children[0].metadata).toMatchObject({ alertType: 'NOTE' });

		await history.requestUndo();
		expect(serialize(deps.doc)).toBe(ALERT);

		await history.requestRedo();
		expect(deps.doc.children[0].metadata).toMatchObject(TIP);
	});

	it('empty patch: no snapshot, no event, metadata unchanged', async () => {
		const { deps, events, actions } = makeTopHarness(parse(ALERT).children);
		const node = deps.doc.children[0];

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await actions.updateBlockMetadata(0, {});

		expect(deps.doc.children[0]).toBe(node);
		expect(editHandler).not.toHaveBeenCalled();
		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
	});

	it('lands no caret when the patch is empty (no commit runs)', async () => {
		const { deps, actions, landings } = makeTopHarness(parse(ALERT).children);
		mountEveryBlock(deps);

		await actions.updateBlockMetadata(0, {}, { caret: { path: [], offset: 0 } });

		expect(landings).toEqual([]);
	});

	it('shallow-merge preserves untouched fields', async () => {
		// A switch to `node.metadata = metadata` (no spread) fails here.
		const { deps, actions } = makeTopHarness(parse(ALERT).children);
		const untouched = { ...deps.doc.children[0].metadata };

		await actions.updateBlockMetadata(0, TIP);

		expect(deps.doc.children[0].metadata).toEqual({ ...untouched, ...TIP });
	});
});

// ── Container scope ───────────────────────────────────────────────────────────

const CONTAINERS = {
	blockquote: () => ({
		inner: makeNode('paragraph', 'hello\n'),
		kind: 'blockquote',
		raw: '> hello\n',
		metadata: { quoteDepth: 1 }
	}),
	list: () => ({
		inner: makeTaskListItem('pending', '[ ] '),
		kind: 'list',
		raw: '- [ ] pending\n',
		metadata: { ordered: false }
	})
} as const;

function makeContainerSetup(containerIndex: number, container: keyof typeof CONTAINERS = 'list') {
	const spec = CONTAINERS[container]();
	const containerNode: any = {
		kind: spec.kind,
		leadingTrivia: '',
		raw: spec.raw,
		...('metadata' in spec ? { metadata: spec.metadata } : {}),
		children: [spec.inner],
		innerPrefix: '',
		innerSuffix: ''
	};
	const padNode = makeNode('paragraph', 'pad\n', {});
	const docNodes = Array.from({ length: containerIndex }, () => padNode).concat([containerNode]);

	const { deps, events, bundle, controller } = makeNestedHarness(docNodes, {
		index: containerIndex
	});

	return {
		bundle,
		deps,
		events,
		controller,
		liveInner: () => deps.doc.children[containerIndex].children![0],
		liveContainer: () => deps.doc.children[containerIndex]
	};
}

describe('updateBlockMetadata: container scope', () => {
	it('mutates inner node metadata and emits metadataUpdate with correct eventPath and fields', async () => {
		const containerIndex = 2;
		const { bundle, liveInner, events } = makeContainerSetup(containerIndex);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await bundle.blockEdit.updateBlockMetadata(0, CHECK);

		expect(liveInner().metadata).toMatchObject(CHECK);

		expect(editHandler).toHaveBeenCalledTimes(1);
		const evt = editHandler.mock.calls[0][0];
		expect(evt.op).toBe('metadataUpdate');
		expect(evt.path).toEqual([containerIndex, 0]);
		expect(evt.detail.fields).toEqual(['taskChecked', 'taskMarker']);
	});

	it('empty patch: early-returns with no commitContainer call and no snapshot', async () => {
		const containerIndex = 1;
		const { bundle, deps, events } = makeContainerSetup(containerIndex);

		const editHandler = vi.fn();
		events.on('edit', editHandler);

		await bundle.blockEdit.updateBlockMetadata(0, {});

		expect(editHandler).not.toHaveBeenCalled();
		expect(deps.undoManager.getStacks().undo).toHaveLength(0);
	});

	it('shallow-merge preserves untouched fields', async () => {
		const { bundle, liveInner } = makeContainerSetup(1);

		await bundle.blockEdit.updateBlockMetadata(0, CHECK);

		expect(liveInner().metadata).toEqual({ marker: '- ', taskItem: true, ...CHECK });
	});

	it('undo after a task patch restores both fields and the bytes', async () => {
		const { bundle, deps, controller, liveInner, liveContainer } = makeContainerSetup(1);
		const history = createHistoryActions(deps, controller);

		await bundle.blockEdit.updateBlockMetadata(0, CHECK);
		await history.requestUndo();

		expect(liveInner().metadata).toMatchObject({ taskChecked: false, taskMarker: '[ ] ' });
		expect(liveContainer().raw).toBe('- [ ] pending\n');
	});

	it('task taskMarker patch rebuilds inner listItem raw and parent list raw', async () => {
		// Without the commit's ancestor rebuild the inner listItem.raw updates while the
		// list's own raw stays stale.
		const { bundle, liveInner, liveContainer } = makeContainerSetup(1, 'list');

		await bundle.blockEdit.updateBlockMetadata(0, CHECK);

		expect(liveInner().raw).toBe('- [x] pending\n');
		expect(liveContainer().raw).toBe('- [x] pending\n');
	});
});

// ── The caret a metadata write asks for ──────────────────────────────────────

// A plugin's `updateOwnMetadata(patch, { caret })` lands through this commit, once, relative to
// the block. Miss-analysis: no test counted the carets a metadata write placed.
describe('updateBlockMetadata with a caret', () => {
	it('lands once at the path below the block, after the write', async () => {
		const h = makeTopHarness('a\n\n> one\n>\n> two\n');
		mountEveryBlock(h.deps);

		await h.actions.updateBlockMetadata(1, { quoteDepth: 1 }, { caret: { path: [1], offset: 2 } });

		expect(h.landings).toEqual([{ leafPath: [1, 1], offset: 2, outcome: 'placed' }]);
	});

	it('leaves the caret where it is when none is asked for', async () => {
		const h = makeTopHarness('a\n\n> one\n');
		mountEveryBlock(h.deps);

		await h.actions.updateBlockMetadata(1, { quoteDepth: 1 });

		expect(h.landings).toEqual([]);
	});
});

// ── A leaf refuses ───────────────────────────────────────────────────────────

// A leaf refuses a metadata write (G1.110). Miss-analysis: fixtures wrote invented fields onto
// paragraphs and allowed the read-back warning, so nothing held a leaf's metadata to its bytes.
const LEAF_SCOPES = {
	'the top level': () => {
		const h = makeTopHarness('pad\n\nhello\n');
		return { ...h, write: () => h.actions.updateBlockMetadata(1, { tagged: true }), path: [1] };
	},
	'a container': () => {
		const h = makeContainerSetup(1, 'blockquote');
		return {
			...h,
			write: () => h.bundle.blockEdit.updateBlockMetadata(0, { tagged: true }),
			path: [1, 0]
		};
	}
};

describe('updateBlockMetadata on a leaf', () => {
	for (const [scope, setup] of Object.entries(LEAF_SCOPES)) {
		it(`writes nothing at ${scope}, warns in dev naming the kind, and reports an error`, async () => {
			const h = setup();
			const before = serialize(h.deps.doc);
			const errors: EditorError[] = [];
			const edits = vi.fn();
			h.events.on('error', (e) => errors.push(e));
			h.events.on('edit', edits);

			expect(await h.write()).toBe(false);

			expect(serialize(h.deps.doc)).toBe(before);
			expect(h.deps.undoManager.getStacks().undo).toHaveLength(0);
			expect(edits).not.toHaveBeenCalled();
			const warns = takeDevWarns();
			expect(warns.map((w) => w.tag)).toEqual(['invariant:metadata-without-rebuild']);
			expect(warns[0].message).toContain("'paragraph'");
			expect(warns[0].message).toContain('replaceRaw');
			expect(errors).toHaveLength(1);
			expect(errors[0]).toMatchObject({
				origin: 'commit',
				context: { op: 'metadataUpdate', path: h.path }
			});
			expect(String(errors[0].error)).toContain('replaceRaw');
		});
	}

	it('still reports the error in production, with no dev warning', async () => {
		configureEditorEnv({ isDev: false, isTest: false });
		const h = LEAF_SCOPES['the top level']();
		const errors: EditorError[] = [];
		h.events.on('error', (e) => errors.push(e));

		expect(await h.write()).toBe(false);

		expect(takeDevWarns()).toEqual([]);
		expect(errors.map((e) => e.origin)).toEqual(['commit']);
	});
});
