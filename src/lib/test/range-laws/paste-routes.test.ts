// @vitest-environment jsdom
// G1.213: every route a paste comes in by leaves the range-edit core's bytes and its caret as the
// byte splice lands it, and one undo gives the bytes back.
// Miss-analysis: each paste route had suites of its own bytes, and none ran every route over one
// place against the answer they all share.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { diffCase, type PasteCase } from '../range-edit/paste-differential';
import { namedCases } from '../range-edit/paste-differential-cases';
import { PENDING_PASTE_ROWS } from './paste-routes-pending';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
	installPlugins(SYNTAX_PLUGINS);
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

const rowKey = (c: PasteCase) => `${c.mode} | ${c.name} | ${c.route} | ${JSON.stringify(c.clip)}`;

describe('every paste route leaves the core’s bytes and caret', () => {
	// Read at collection, before any test's setup installs the plugins for itself.
	installPlugins(SYNTAX_PLUGINS);
	const cases = namedCases(defaultGrammarView);

	it.each(cases.map((c) => [rowKey(c), c] as const))('%s', async (key, input) => {
		const row = await diffCase(input);
		// A place or a route jsdom can't drive decides nothing here; the e2e specs hold it.
		if (row.verdict === 'undetermined' || row.verdict === 'no core') return;
		const today = 'source' in row.today ? row.today.source : '';
		const agrees =
			row.verdict === 'same' &&
			row.undone !== false &&
			(input.pin === undefined || today === input.pin);
		if (key in PENDING_PASTE_ROWS) {
			expect(agrees, `${PENDING_PASTE_ROWS[key]} agrees now: take it off the list`).toBe(false);
			return;
		}
		if (input.pin !== undefined) expect(today, 'the pinned bytes').toBe(input.pin);
		expect(row.verdict, JSON.stringify({ today: row.today, core: row.core })).toBe('same');
		expect(row.undone, 'one undo').not.toBe(false);
	});

	it('every pending row names a case', () => {
		const keys = new Set(cases.map(rowKey));
		expect(Object.keys(PENDING_PASTE_ROWS).filter((key) => !keys.has(key))).toEqual([]);
	});
});
