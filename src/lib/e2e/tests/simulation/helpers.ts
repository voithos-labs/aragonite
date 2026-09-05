import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { ExpectationTracker } from '../../simulation/expectation';
import { attachErrorCollector, type ErrorCollector } from '../../simulation/error-collector';
import type { ImeDriver } from '../../simulation/ime';
import { type SimContext } from '../../simulation/invariants';

// Shared bootstrap + probes for the note-taking simulation specs.

export interface SimContextOpts {
	/** A collector already attached and started, for a session that must watch the LOAD phase.
	 *  Passing one takes the helper's own attach path out of reach, so it can neither move nor
	 *  restart a collector that is already watching. */
	errors?: ErrorCollector;
	ime?: ImeDriver;
}

// The SimContext every session runs its oracles against. Call AFTER loading the fixture.
export async function makeSimContext(
	page: Page,
	editor: EditorPage,
	label: string,
	opts: SimContextOpts = {}
): Promise<SimContext> {
	let errors = opts.errors;
	if (errors === undefined) {
		errors = attachErrorCollector(page);
		await errors.start();
	}
	const tracker = new ExpectationTracker(await editor.bridge.getSource());
	return { page, editor, tracker, errors, label, ime: opts.ime };
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
