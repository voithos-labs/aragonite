// @vitest-environment jsdom
// G1.218: after a paste commits, the document holds the core's answer as the byte splice writes
// it. Miss-analysis: the route table compared every route's bytes with the core's, but nothing in
// a running editor did, so a text block's own write that re-decided its bytes showed only there.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { splicedBytes } from '#lib/tree-operations/spliced-openers.js';
import { checkPasteLanded } from '#lib/invariants/paste-landed.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { mountCase, pasteGesture } from '../range-laws/gestures';

/** Whether the paste's arm question is answered as built, or forced to the block's own write. */
const arm = vi.hoisted(() => ({ forced: false }));

vi.mock('#lib/editor-actions/paste-coordinator.js', async (original) => {
	const actual = await original<typeof import('#lib/editor-actions/paste-coordinator.js')>();
	const createPasteCoordinator: typeof actual.createPasteCoordinator = (...args) => {
		const made = actual.createPasteCoordinator(...args);
		const landsAsWritten: typeof made.landsAsWritten = (...asked) =>
			arm.forced || made.landsAsWritten(...asked);
		return { ...made, landsAsWritten };
	};
	return { ...actual, createPasteCoordinator };
});

const was = (source: string) =>
	measured(readAsOpened(source, { grammar: defaultGrammarView, scope: 'document' }));

describe('the check', () => {
	it('passes the answer, and names the first byte of any other document', () => {
		expect(checkPasteLanded('abxc\n', 'abxc\n')).toBe(null);
		const off = checkPasteLanded('abxc\n', 'abc\n\nx\n');
		expect(off?.code).toBe('paste-lands-core-answer');
		expect(off?.message).toContain('byte 2');
	});

	it('takes the answer as the byte splice writes it, a fence it opens closed', () => {
		const before = 'x\n\n```\ny\n```\n';
		const answer = '```\n\n```\ny\n```\n';
		const written = splicedBytes(was(before), before, answer, defaultGrammarView);
		expect(written).toBe('```\n```\n\n```\ny\n```\n');
		expect(checkPasteLanded(written, written)).toBe(null);
	});
});

describe('in a running editor', () => {
	beforeAll(installLayoutStubs);
	beforeEach(() => {
		installClipboardEvents();
		installSystemClipboard();
		registerDefaultContextActions();
		installPlugins(SYNTAX_PLUGINS);
	});
	afterEach(async () => {
		arm.forced = false;
		await destroyMountedEditors();
		takeDevWarns();
	});

	/** `xy` pasted at `offset` of the block at `path`: the guard fires with the leaf write forced only. */
	async function forcedOnlyWarns(source: string, path: number[], offset: number) {
		for (const [forced, warns] of [
			[true, ['invariant:paste-lands-core-answer']],
			[false, []]
		] as const) {
			arm.forced = forced;
			const editor = mountCase(source, 'source');
			await editor.settle();
			placeCaret(surfaceAt(editor, path), offset);
			await editor.settle();
			await pasteGesture(editor, { 'text/plain': 'xy' }, 'key');
			expect(takeDevWarns().map((warn) => warn.tag)).toEqual(warns);
			await destroyMountedEditors();
		}
	}

	// A callout's rebuild puts a blank line over a body a delete emptied.
	it('a callout body', () => forcedOnlyWarns(':::note\n\n:::\n', [0, 1], 0));
	// No shape is left where the rule alone rewrites the core's bytes: the core writes a closing line
	// through that rule (`range-edit/paste-literal-fence.test.ts`), so this row has no witness.
	it.skip('a closing fence', () => forcedOnlyWarns('```js\ncode\n```\n\nAfter\n', [0], 11));

	// A paste that makes the paragraph a table: the block's own write would put the caret past the
	// cell's text, where the core's caret ends the pasted text.
	it.each(['source', 'live'] as const)('a table the paste completes, %s', async (mode) => {
		const editor = mountCase('a\n|-|-|\n\nAfter\n', mode);
		await editor.settle();
		placeCaret(surfaceAt(editor, [0]), 0);
		await editor.settle();
		await pasteGesture(editor, { 'text/plain': '|-|' }, 'key');
		await pressHardwareKey(document.activeElement as HTMLElement, { key: 'Z' });
		await editor.settle();
		expect(editor.source()).toBe('|-|Za\n|-|-|\n\nAfter\n');
	});
});
