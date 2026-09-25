import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { Gestures } from '../../simulation/gestures';
import { attachErrorCollector } from '../../simulation/error-collector';
import { makeRng } from '../../simulation/rng';
import { assertCheckpoint } from '../../simulation/invariants';
import { makeSimContext } from './helpers';

// GitHub alerts, run in the default gate. A `> [!TYPE]` blockquote is its own `githubAlert`
// container, with its bytes untouched and the marker only in the container's raw text, so
// building one, editing inside it, merging a middle child and unwrapping it are exactly the
// container corruption these checks exist to catch.
//
// The alert's marker breaks the paragraph above it, so building one from scratch never leaves
// two blocks a single newline apart, and the reparse check runs throughout.

const ALERT_DOC =
	'Intro paragraph.\n\n' + // [0]: a new alert is typed after this
	'> [!WARNING]\n> first body\n>\n> second body\n\n' + // [1]: an alert with two children
	'Tail paragraph.\n'; // [2]

test.describe('github-alert-ops simulation', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('admonitions');
	});

	test('alert formation, inner edit, contained merge, unwrap, and undo stay corruption-free', async ({
		page
	}) => {
		const errors = attachErrorCollector(page);
		await errors.start();

		await editor.loadContent(ALERT_DOC);
		await editor.waitForRenderFlush();

		const ctx = await makeSimContext(page, editor, 'github-alert-ops', { errors });
		const g = new Gestures(ctx, makeRng(1));

		await assertCheckpoint(ctx, 'loaded');
		expect(await editor.bridge.getBlockKind(1)).toBe('githubAlert');

		// ── Build an alert after the last block; the one already there stays at [1] ─
		// Types `> [!TIP]` and a body key by key, so the block becomes a container and the
		// body lands inside it. The typed alert ends up at [3].
		await g.typeGithubAlert(2, 'TIP', 'Fresh alert body');
		expect(await editor.bridge.getBlockKind(3)).toBe('githubAlert');
		expect(await editor.bridge.getSource()).toContain('> [!TIP]\n> Fresh alert body');
		await assertCheckpoint(ctx, 'typed-from-scratch');

		// ── Editing inside the typed alert rebuilds it and keeps its kind ───────────
		await g.editContainerBody([3, 0], ' plus');
		expect(await editor.bridge.getBlockKind(3)).toBe('githubAlert');
		expect(await editor.bridge.getSource()).toContain('Fresh alert body plus');
		await assertCheckpoint(ctx, 'body-edited');

		// ── Move the existing alert's body children within the container ────────────
		// Alt+ArrowDown swaps body child 0 in place; the alert keeps its kind, its marker and
		// its position in the document, rather than jumping out as it once did.
		await g.reorderGithubAlertBodyChild(1, 0, 1);
		expect(await editor.bridge.getBlockKind(1)).toBe('githubAlert');
		expect(await editor.bridge.getSource()).toContain('[!WARNING]');
		await assertCheckpoint(ctx, 'body-reordered');

		// ── Merging a middle child stays inside the container ────────────────────────
		// Backspace at the start of a body child that is not the first joins it to the one
		// above; the alert keeps its kind, its marker and its position, which is checked.
		await g.mergeGithubAlertMiddleChild(1, 1);
		await assertCheckpoint(ctx, 'middle-child-merge');

		// ── Unwrap the existing alert: the marker goes and [1] reparses as plain ────
		await g.unwrapGithubAlert(1);
		expect(await editor.bridge.getBlockKind(1)).not.toBe('githubAlert');
		expect(await editor.bridge.getSource()).not.toContain('[!WARNING]');
		await assertCheckpoint(ctx, 'unwrapped');

		// ── One undo of that Backspace brings the alert back ─────────────────────────
		await g.pause();
		await g.undo();
		expect(await editor.bridge.getBlockKind(1)).toBe('githubAlert');
		expect(await editor.bridge.getSource()).toContain('[!WARNING]');
		await assertCheckpoint(ctx, 'undo-unwrap');
	});
});
