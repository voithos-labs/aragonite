// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createCaretRestore, type CaretRestoreDeps } from '$lib/selection/caret-restore';
import type { EditorSelection } from '$lib/selection/primitives';
import type { SelectionRestoreOutcome } from '$lib/selection/selection-restore';
import { caretAt } from '$lib/test/harness/editor-selection';

// What the document selection survives while a menu or overlay input borrows focus: it goes back
// through the caret landing by path, and the editor root takes focus when it can't.

let root: HTMLElement;
let chromeInput: HTMLInputElement;
let live: EditorSelection | null;
let restored: EditorSelection[];
let outcome: SelectionRestoreOutcome;
let deps: CaretRestoreDeps;

beforeEach(() => {
	document.body.replaceChildren();
	root = document.createElement('div');
	root.tabIndex = -1;
	chromeInput = document.createElement('input');
	document.body.append(root, chromeInput);
	live = caretAt([3], 4);
	restored = [];
	outcome = 'applied';
	deps = {
		getEditorEl: () => root,
		read: () => live,
		restore: async (selection) => {
			restored.push(selection);
			return outcome;
		}
	};
});

describe('caret restore', () => {
	// Miss-analysis: the saved caret was a DOM range, and every test kept its block mounted, so
	// none saw it lost once the find bar's jump windowed the block out.
	it('puts the saved selection back through the caret landing, by path', async () => {
		const restore = createCaretRestore(deps);
		restore.saveCurrent();
		live = caretAt([190], 0);
		chromeInput.focus();

		await restore.restore();

		expect(restored).toEqual([caretAt([3], 4)]);
		expect(document.activeElement).toBe(chromeInput);
	});

	it.each(['unresolvable', 'unplaced'] as const)(
		'falls back to the editor root when the restore comes back %s',
		async (miss) => {
			outcome = miss;
			const restore = createCaretRestore(deps);
			restore.saveCurrent();
			chromeInput.focus();

			await restore.restore();

			expect(document.activeElement).toBe(root);
		}
	);

	it('falls back to the root when there was no caret to save', async () => {
		live = null;
		const restore = createCaretRestore(deps);
		restore.saveCurrent();
		chromeInput.focus();

		await restore.restore();

		expect(restored).toEqual([]);
		expect(document.activeElement).toBe(root);
	});

	it('clears the slot, so a second restore cannot put a stale selection back', async () => {
		const restore = createCaretRestore(deps);
		restore.saveCurrent();
		await restore.restore();
		chromeInput.focus();

		await restore.restore();

		expect(restored).toHaveLength(1);
		expect(document.activeElement).toBe(root);
	});
});
