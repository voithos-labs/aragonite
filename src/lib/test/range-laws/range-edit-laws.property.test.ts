// @vitest-environment jsdom
// The range-edit laws, one property each, through the mounted editor's own event routes. A run that
// breaks a law fails unless its class is in the known-failures table, whose every class's repro
// is pinned in `range-law-cases.test.ts`. `npm run test:laws:report` runs them deep.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { LAW_SPECS, isLawLine } from './law-specs';
import { unknownLines } from './known-failures';

/** Draws per law in the commit gate: the budget is the whole file's few seconds. */
const RUNS: Record<string, number> = {
	L1: 5,
	L2: 3,
	L3: 5,
	L4: 3,
	L5: 3,
	L7: 4,
	L8: 4,
	L9: 5,
	L10: 5,
	L11: 3
};
const SEED = freshOrFixedSeed(20261105);

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

describe('the range-edit laws hold, save the known violations', () => {
	for (const spec of LAW_SPECS) {
		it(`${spec.law} ${spec.name}`, async () => {
			await fc.assert(
				fc.asyncProperty(spec.arb, async (args) => {
					try {
						const run = await spec.run(args);
						expect(unknownLines(run, (line) => isLawLine(spec.law, line))).toEqual([]);
					} finally {
						await destroyMountedEditors();
						takeDevWarns();
					}
				}),
				{ numRuns: RUNS[spec.law], seed: SEED }
			);
		}, 60_000);
	}
});
