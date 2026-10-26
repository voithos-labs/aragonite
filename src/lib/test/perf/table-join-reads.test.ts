// A block placed flush under a table that its first line ends costs one read of the table, the
// merge's one-line probe: the join question asks the table nothing it can't answer by its rows.
// Miss-analysis: the join rows asserted bytes, which the extra parses got right, never their cost.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { configureEditorEnv, resetEditorEnv } from '@voithos-labs/aragonite/dev-checks';
import type { CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { fixUpEdit } from '#lib/tree-operations/fix-up/apply.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

// The production cost: a dev build's checks read the window again by design.
beforeEach(() => configureEditorEnv({ isDev: false }));
afterEach(() => {
	disablePerfInstruments();
	resetEditorEnv();
});

const rows = (n: number) => Array.from({ length: n }, (_, i) => `| r${i} |\n`).join('');

describe('the join question under a table', () => {
	it.each(['# heading\n', '---\n', '- item\n'])('reads the table once for %j', (follower) => {
		const table = `| a |\n| - |\n${rows(200)}`;
		const doc = parse(table);
		const body = documentBody(doc);
		const before = [...body.children];
		const placed: CstNode = parse(follower).children[0];
		body.children.push(placed);
		enablePerfInstruments();
		resetPerfInstruments();

		fixUpEdit(
			body,
			{ change: { op: 'insert', at: 1, count: 1 }, before },
			defaultGrammarView,
			createSharingState()
		);

		expect(perfSnapshot().parseBytes).toBeLessThanOrEqual(table.length + follower.length);
		expect(serialize(doc)).toBe(table + follower);
	});
});
