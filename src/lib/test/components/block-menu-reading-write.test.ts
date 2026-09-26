// @vitest-environment jsdom
// A block menu opened in source mode and picked after a switch to reading mode reaches the commit
// with no mode check of its own (#517); the commit's reading-mode check is what answers it.
// Miss-analysis: every reading-mode test switched modes before opening a menu, and the menu's
// only reading check sits on the right-click, so no test picked a row after the switch.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRootMenus, type BlockMenuModel } from '$lib/components/editor-root-menus';
import { registerDefaultContextActions } from '$lib/components/menu/default-context-actions';
import { serialize } from '$lib/core/serializer';
import {
	READING_WRITE_TAG,
	__setReadingWritePolicyForTests,
	type ReadingWritePolicy
} from '$lib/editor-actions/commit/reading-write-gate';
import type { PresentationMode } from '$lib/presentation-mode';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { fixtureReading } from '../harness/fixture-grammar';
import { makeTopHarness } from '../harness/editor-actions';
import { settleEditor } from '../harness/settle';
import { takeDevWarns } from '../support/warn-gate';

const SOURCE = '```\ncode\n```\n\nprose here\n';

let restorePolicy: ReadingWritePolicy | null = null;

beforeEach(() => {
	document.body.replaceChildren();
	__resetSchemaRegistriesForTests();
	registerDefaultContextActions();
});

afterEach(() => {
	if (restorePolicy) __setReadingWritePolicyForTests(restorePolicy);
	restorePolicy = null;
});

/** Right-clicks the fence in source mode, switches to reading, then picks "Remove". */
async function removeFenceAfterSwitchToReading() {
	let mode: PresentationMode = 'source';
	const editor = makeTopHarness(SOURCE, { reading: fixtureReading({ mode: () => mode }) });
	const root = document.createElement('div');
	const fence = document.createElement('div');
	fence.className = 'block-host';
	fence.setAttribute('data-block-path', '[0]');
	fence.append(document.createElement('pre'));
	root.append(fence);
	document.body.append(root);

	let menu: BlockMenuModel | null = null;
	const menus = createRootMenus({
		get editorEl() {
			return root;
		},
		get mode() {
			return mode;
		},
		getDoc: () => editor.doc,
		isHostChrome: () => false,
		blockEdit: editor.actions,
		placeCaretAtPoint: () => true,
		insertMarkdown: async () => true,
		insertCatalogue: () => [],
		activation: everyInstalledPlugin,
		setMenu: (next) => (menu = next)
	});
	root.addEventListener('contextmenu', menus.onRootContextMenu);
	fence.firstElementChild!.dispatchEvent(
		new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
	);
	expect(menu, 'the fence opened its block menu in source mode').not.toBeNull();

	mode = 'reading';
	menu!.pick('block.remove');
	await settleEditor();
	return editor;
}

describe('a block menu left open across a switch to reading mode (#517)', () => {
	it('under the warn policy, the delete reports itself, naming the operation and the menu', async () => {
		restorePolicy = __setReadingWritePolicyForTests('warn');
		await removeFenceAfterSwitchToReading();
		const fires = takeDevWarns().filter((w) => w.tag === READING_WRITE_TAG);
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain("wrote 'delete' in reading mode");
		expect(fires[0].message).toContain('components/editor-root-menus.ts');
	});

	it('under the refuse policy, the delete writes nothing, pushes no undo entry and emits no edit', async () => {
		restorePolicy = __setReadingWritePolicyForTests('refuse');
		const editor = await removeFenceAfterSwitchToReading();
		expect(serialize(editor.doc)).toBe(SOURCE);
		expect(editor.deps.undoManager.canUndo).toBe(false);
		expect(editor.edits).toEqual([]);
		const fires = takeDevWarns().filter((w) => w.tag === READING_WRITE_TAG);
		expect(fires.map((w) => w.message.split(',')[0])).toEqual([
			"declined 'delete' in reading mode"
		]);
	});
});
