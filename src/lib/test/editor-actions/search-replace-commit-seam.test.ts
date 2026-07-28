import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import type { CstNode } from '$lib/core/nodes';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { testClosure } from '$lib/test/support/closure';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createSearchReplace } from '$lib/editor-actions/search-replace';
import type { EditEvent, EditorError } from '$lib/editor-events';
import { makeEditorActionsDeps } from '../harness/editor-actions';

// The subtree rebuild dispatches into `descriptor.rebuildRaw` — plugin code —
// outside any commit and after the batch's single undo snapshot was pushed. An
// unattributed throw there left the snapshot pushed, the redo stack cleared, and
// the editor's own `error` channel silent. The aggregate edit event also reported
// `path: []` for `replaceOne`, which operates on exactly one known index.

function scanRaw(raw: string, needle: string, path: number[]) {
	const at = raw.indexOf(needle);
	return { path, start: at, end: at + needle.length };
}

describe('replaceOne reports the subtree it operated on', () => {
	it('emits the doc-absolute path of the single replaced top-level block', async () => {
		const doc = parse('one\n\ntwo\n\nthe cat sat\n');
		const { deps, events } = makeEditorActionsDeps(doc.children);
		const edits: EditEvent[] = [];
		events.on('edit', (e) => edits.push(e));
		const sr = createSearchReplace(deps, createUndoController(deps));

		await sr.replaceOne({ path: [2], start: 4, end: 7 }, 'dog');

		expect(edits).toHaveLength(1);
		expect(edits[0]).toMatchObject({ op: 'replaceBlock', path: [2], detail: { count: 1 } });
	});

	// Several subtrees genuinely have no single operated node, so the aggregate
	// keeps the empty path there.
	it('replaceAll across two subtrees keeps the empty path', async () => {
		const doc = parse('a cat\n\nanother cat\n');
		const { deps, events } = makeEditorActionsDeps(doc.children);
		const edits: EditEvent[] = [];
		events.on('edit', (e) => edits.push(e));
		const sr = createSearchReplace(deps, createUndoController(deps));

		await sr.replaceAll(
			[scanRaw('a cat\n', 'cat', [0]), scanRaw('another cat\n', 'cat', [1])],
			'dog'
		);

		expect(edits).toHaveLength(1);
		expect(edits[0].path).toEqual([]);
	});
});

describe('a plugin rebuildRaw throw during the subtree rebuild is contained', () => {
	let hostileKind: ReturnType<typeof declarePluginKind>;
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		hostileKind = declarePluginKind('replace-hostile');
		registerBlockKind(hostileKind, {
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: {
				contract: 'strip',
				rebuildRaw: () => {
					throw new Error('rebuildRaw exploded');
				}
			}
		});
	});

	function hostileDoc() {
		const child: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'the cat sat\n' };
		const host: CstNode = {
			kind: hostileKind,
			leadingTrivia: '',
			raw: 'the cat sat\n',
			children: [child]
		};
		const { deps, events } = makeEditorActionsDeps([host]);
		const errors: EditorError[] = [];
		events.on('error', (e) => errors.push(e));
		return { deps, errors, sr: createSearchReplace(deps, createUndoController(deps)) };
	}

	it('does not let the throw escape the caller', async () => {
		const { sr } = hostileDoc();
		await expect(sr.replaceOne({ path: [0, 0], start: 4, end: 7 }, 'dog')).resolves.toBe(0);
	});

	it('routes the throw to the error channel as a commit-origin failure', async () => {
		const { sr, errors } = hostileDoc();

		await sr.replaceOne({ path: [0, 0], start: 4, end: 7 }, 'dog');

		expect(errors).toHaveLength(1);
		expect(errors[0].origin).toBe('commit');
		expect(String((errors[0].error as Error).message)).toContain('rebuildRaw exploded');
	});

	it('leaves the document untouched rather than half-applied', async () => {
		const { sr, deps } = hostileDoc();

		await sr.replaceOne({ path: [0, 0], start: 4, end: 7 }, 'dog');

		expect(serialize(deps.doc)).toBe('the cat sat\n');
	});

	it('emits no aggregate edit event when nothing was replaced', async () => {
		const { deps, sr } = hostileDoc();
		const edits: EditEvent[] = [];
		deps.events.on('edit', (e: EditEvent) => edits.push(e));

		await sr.replaceOne({ path: [0, 0], start: 4, end: 7 }, 'dog');

		expect(edits).toEqual([]);
	});
});

describe('the hostile-kind fixture is real', () => {
	it('a well-behaved container of the same shape does replace', async () => {
		__resetSchemaRegistriesForTests();
		const kind = declarePluginKind('replace-friendly');
		registerBlockKind(kind, {
			mergeRole: 'not-mergeable',
			editable: true,
			supportsInline: false,
			closure: testClosure,
			container: { contract: 'strip', rebuildRaw: vi.fn() }
		});
		const child: CstNode = { kind: 'paragraph', leadingTrivia: '', raw: 'the cat sat\n' };
		const { deps } = makeEditorActionsDeps([
			{ kind, leadingTrivia: '', raw: 'the cat sat\n', children: [child] }
		]);
		const sr = createSearchReplace(deps, createUndoController(deps));

		expect(await sr.replaceOne({ path: [0, 0], start: 4, end: 7 }, 'dog')).toBe(1);
	});
});
