// @vitest-environment jsdom
// G1.213: every route a paste comes in by leaves the range-edit core's bytes and its caret as the
// byte splice lands it, by the commit the core's answer calls for (a text block's own write where
// it names one and that write lands its bytes, else the byte splice), and one undo gives the bytes
// back.
// Miss-analysis: each paste route had suites of its own bytes, and none ran every route over one
// place against the answer they all share.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { syntaxGrammar } from '../support/syntax-grammar';
import { diffCase, type PasteCase, type PasteRow } from './paste-differential';
import { namedCases } from './paste-differential-cases';

/** The commits each paste took, in order: a text block's own write, or the byte splice. */
const commits = vi.hoisted(() => ({ taken: [] as ('leaf' | 'splice')[] }));

vi.mock('#lib/selection/cross-block/range-removal.js', async (original) => {
	const actual = await original<typeof import('#lib/selection/cross-block/range-removal.js')>();
	const commitBytes: typeof actual.commitBytes = (...args) => {
		commits.taken.push('splice');
		return actual.commitBytes(...args);
	};
	return { ...actual, commitBytes };
});

vi.mock('#lib/editor-actions/paste-coordinator.js', async (original) => {
	const actual = await original<typeof import('#lib/editor-actions/paste-coordinator.js')>();
	const createPasteCoordinator: typeof actual.createPasteCoordinator = (...args) => {
		const made = actual.createPasteCoordinator(...args);
		const writeLeaf: typeof made.writeLeaf = (...write) => {
			commits.taken.push('leaf');
			return made.writeLeaf(...write);
		};
		return { ...made, writeLeaf };
	};
	return { ...actual, createPasteCoordinator };
});

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

const rowKey = (c: PasteCase) => `${c.mode} | ${c.name} | ${c.route} | ${JSON.stringify(c.clip)}`;

/** Why a row parts from the core, or null where it agrees. A pin decides the bytes where it
 *  differs from the core's: the side of a hidden edge the core isn't handed, a kind's own answer. */
function parts(input: PasteCase, row: PasteRow, took: string): string | null {
	const today = 'source' in row.today ? row.today.source : '';
	const core = row.core && 'source' in row.core ? row.core.source : null;
	if (input.pin !== undefined && today !== input.pin)
		return `pinned ${JSON.stringify(input.pin)}, left ${JSON.stringify(today)}`;
	const pinnedApart = input.pin !== undefined && core !== input.pin;
	const agrees = row.verdict === 'same' || (row.verdict === 'caret' && row.landsSame);
	if (!pinnedApart && !agrees)
		return `${row.verdict}: ${JSON.stringify(row.today)} for ${JSON.stringify(row.core)}`;
	// The block's own write is taken exactly where it lands the core's bytes, for its cost.
	const arm = row.coreLeafLands ? 'leaf' : 'splice';
	if (!pinnedApart && row.coreLeaf && took !== arm)
		return `text in one block took ${took || 'no commit'}, where its own write lands ${row.coreLeafLands ? 'the core’s bytes' : 'other bytes'}`;
	// Across blocks the editor removes, then pastes where it holds the caret: text there is a leaf's.
	const acrossBlocks = row.tags?.place === 'range across blocks';
	if (!pinnedApart && !acrossBlocks && row.coreLeaf === false && took.includes('leaf'))
		return `a landing the core names no block for took ${took}`;
	return row.undone === false ? 'one undo did not give the bytes back' : null;
}

it('every paste route leaves the core’s bytes and caret', { timeout: 300_000 }, async () => {
	const out: string[] = [];
	for (const input of namedCases(syntaxGrammar())) {
		commits.taken = [];
		const row = await diffCase(input);
		await destroyMountedEditors();
		// A place or a route jsdom can't drive decides nothing here; the e2e specs hold it.
		if (row.verdict === 'undetermined' || row.verdict === 'no core' || input.drafted) continue;
		const parted = parts(input, row, commits.taken.join('+'));
		if (parted) out.push(`${rowKey(input)}: ${parted}`);
	}
	expect(out).toEqual([]);
});
