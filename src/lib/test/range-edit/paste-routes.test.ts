// @vitest-environment jsdom
// G1.213: every route a paste comes in by leaves the range-edit core's bytes and its caret as the
// byte splice lands it, and one undo gives the bytes back.
// Miss-analysis: each paste route had suites of its own bytes, and none ran every route over one
// place against the answer they all share.
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { diffCase, type PasteCase, type PasteRow } from './paste-differential';
import { namedCases } from './paste-differential-cases';
import { PENDING_PASTE_ROWS } from './paste-routes-pending';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

const rowKey = (c: PasteCase) => `${c.mode} | ${c.name} | ${c.route} | ${JSON.stringify(c.clip)}`;

/** Why a row parts from the core, or null where it agrees: its bytes, its caret, its pin, its undo. */
function parts(input: PasteCase, row: PasteRow): string | null {
	const today = 'source' in row.today ? row.today.source : '';
	if (input.pin !== undefined && today !== input.pin)
		return `pinned ${JSON.stringify(input.pin)}, left ${JSON.stringify(today)}`;
	if (row.verdict !== 'same')
		return `${row.verdict}: ${JSON.stringify(row.today)} for ${JSON.stringify(row.core)}`;
	return row.undone === false ? 'one undo did not give the bytes back' : null;
}

it('every paste route leaves the core’s bytes and caret', { timeout: 300_000 }, async () => {
	installPlugins(SYNTAX_PLUGINS);
	const cases = namedCases(defaultGrammarView);
	const keys = new Set(cases.map(rowKey));
	expect(
		Object.keys(PENDING_PASTE_ROWS).filter((key) => !keys.has(key)),
		'pending rows that name no case'
	).toEqual([]);
	const out: string[] = [];
	for (const input of cases) {
		const key = rowKey(input);
		const row = await diffCase(input);
		await destroyMountedEditors();
		// A place or a route jsdom can't drive decides nothing here; the e2e specs hold it.
		if (row.verdict === 'undetermined' || row.verdict === 'no core') continue;
		const parted = parts(input, row);
		const pending = PENDING_PASTE_ROWS[key];
		if (pending && !parted) out.push(`${key}: agrees now, so ${pending} leaves the pending list`);
		if (!pending && parted) out.push(`${key}: ${parted}`);
	}
	expect(out).toEqual([]);
});
