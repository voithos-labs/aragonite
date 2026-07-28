import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector } from '../../simulation/error-collector';
import { type SimContext } from '../../simulation/invariants';

// Shared bootstrap + probes for the note-taking simulation specs.

// Attach the error collector, arm it, and seed an ExpectationTracker from the
// current source — the SimContext every session runs its oracles against. Call
// AFTER loading the fixture; sessions that must watch the load phase for errors
// keep their own attach-before-load bootstrap instead.
export async function makeSimContext(
	page: Page,
	editor: EditorPage,
	label: string
): Promise<SimContext> {
	const errors = attachErrorCollector(page);
	await errors.start();
	const tracker = new ExpectationTracker(await editor.bridge.getSource());
	return { page, editor, tracker, errors, label };
}

// Top-level index of the first child with `kind` — re-derived before each phase so
// a script survives the index shift an insert, paste, or merge introduces.
export async function topLevelIndexOf(page: Page, kind: string): Promise<number> {
	return page.evaluate(
		(k) =>
			(window as any).__test
				.getDocument()
				.children.findIndex((c: { kind?: string }) => c.kind === k),
		kind
	);
}
