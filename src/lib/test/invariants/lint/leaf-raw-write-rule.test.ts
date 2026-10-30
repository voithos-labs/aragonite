/**
 * A write to a leaf's raw outside the content write names the kind's rule (G4.28). The content
 * write applies the rule itself (`legalizeWrite`); a route that writes `<node>.raw`, or hands
 * `installOwnRaw` its bytes, goes through `writeOwnRaw` or `normalizeOwnRaw`, or is counted below
 * with the reason it cannot reach a kind that declares a rule. The fence rule keeps one implementation.
 */

import { describe, it, expect } from 'vitest';
import {
	callSites,
	collectEditorSources,
	rawAssignments,
	sourceFile,
	stripComments,
	type SourceFile
} from './scan-source';
import { SOURCE } from './source-paths';
import { describeManifests } from './file-rule';

const READERS_HOME = SOURCE.nodePrimitives;
const CONTENT_WRITE = SOURCE.contentWrite;

/** The fence rule has one implementation, which only the kinds' write rules reach. */
const FENCE_HOME = SOURCE.fenceRule;

/** Every site sizing a fence run over a body, which is a wider set than the write rule. */
const ESCALATION_SITES: Record<string, string> = {
	'src/lib/core/parsers/fence-syntax.ts':
		'the grammar leaf that defines it, and the closer the fence reading gives a write that left one open',
	[FENCE_HOME]: 'the fencedCode write rule',
	'src/lib/debug/diagnostics-report.ts':
		'sizes the section fences of a field report whose bodies routinely carry fences of their own',
	'packages/mermaid/src/mermaid-kind.ts':
		'sizes the fence its metadata body is rebuilt inside — the body is never re-parsed here',
	'src/lib/plugin.ts': 'the author barrel: a plugin rebuilding its own raw needs the same rule'
};

// ── The bare write: a byte write that names neither function ─────────────────

/** `installOwnRaw` takes bytes it trusts to be legal already, so a call outside the writers'
 *  module and the content write counts as a bare write too. */
function installCalls(sources: SourceFile[]): Array<{ relPath: string }> {
	return sources
		.filter((f) => f.relPath !== READERS_HOME && f.relPath !== CONTENT_WRITE)
		.flatMap((f) => callSites(f.code, 'installOwnRaw').map(() => ({ relPath: f.relPath })));
}

function bareWrites(sources: SourceFile[]): Array<{ relPath: string }> {
	return [...rawAssignments(sources), ...installCalls(sources)];
}

/** Files holding a `<node>.raw =` write that consults no kind rule, counted so a new write fails.
 *  Each is a kind re-emitting its own bytes, or a write that cannot reach a kind with a rule. */
const BARE_RAW_WRITE_ALLOWLIST: Record<string, { count: number; why: string }> = {
	[READERS_HOME]: { count: 1, why: 'the one allowed writer itself' },
	[CONTENT_WRITE]: {
		count: 5,
		why: 'the reparse path every write takes: each one is re-read from a parse, restores bytes the slot already held, or re-attaches the blank line that parse stripped (GH #97)'
	},
	'src/lib/tree-operations/node-ops.ts': {
		count: 3,
		why: 'the split re-attaches the blank line that parse stripped (GH #97); both branches of `joinIntoLeaf` land bytes that already crossed `legalizeWrite` and a fragment reparse (GH #54)'
	},
	'src/lib/schema/container-rebuilders.ts': {
		count: 2,
		why: 'the table grid re-emits its own bytes from its rows (G4.20 branch 3 reads the same writes)'
	},
	'src/lib/schema/child-spans.ts': {
		count: 3,
		why: 'the concat container shape re-emitting its own bytes from its children: its span-seeding rebuild and the one-region splice; and a marker gaining its space in its own line'
	},
	'src/lib/schema/strip-rebuild.ts': {
		count: 4,
		why: 'the strip container shape re-emitting its own bytes from its children: its span-seeding rebuild, the whole-body fallback, and the opener line set aside and put back around them'
	},
	'src/lib/core/directive/kinds.ts': { count: 1, why: 'the rebuildRaw every `:::` container uses' },
	'packages/admonitions/src/github-alert-kind.ts': {
		count: 1,
		why: "the alert's own rebuildRaw for an empty body; a filled one rebuilds through `rebuildStripRaw`"
	},
	'packages/details/src/details-kind.ts': {
		count: 1,
		why: "the details container's rebuildRaw"
	},
	'packages/mermaid/src/mermaid-kind.ts': {
		count: 1,
		why: 'the mermaid leaf re-emits its fence from its own metadata: for its bytes, the kind is itself the rule'
	},
	'src/lib/editor-actions/search-replace.ts': {
		count: 1,
		why: 'find and replace installs the bytes `legalizeWrite` returned into a private copy, which it then reparses whole'
	},
	'src/lib/editor-actions/commit/saved-bytes.ts': {
		count: 1,
		why: 'a rollback restores raws the tree already held; nothing new is created'
	},
	'src/lib/selection/cross-block/range-delete/range-delete-ceremony.ts': {
		count: 4,
		why: 'the chrome-clear and the truncation atoms’ two chrome-endpoint branches, reserved-chrome slots no leaf kind declaring a rule can occupy; and the endpoint reparse re-attaching the blank line that parse stripped (GH #97)'
	},
	'src/lib/selection/cross-block/range-delete/range-delete-table.ts': {
		count: 1,
		why: 'a cell clear; a cleared cell is empty, which `tableCell`’s own rule already returns unchanged'
	},
	'src/lib/tree-operations/list/reconcile-task.ts': {
		count: 3,
		why: "moves the task marker between the item's metadata and its first paragraph, kind-guarded to paragraph; and hands a to-do's re-read text back the blank lines its parse split off, before anything lands"
	},
	'src/lib/tree-operations/list/list-builders.ts': {
		count: 3,
		why: 'a new item, before any write installs it, moves the spaces its widened marker takes off its first block, moves its lines to the new column, or writes its opener line alone'
	},
	'src/lib/tree-operations/list/task-paragraph.ts': {
		count: 1,
		why: 'gives the spaces a list item’s marker line takes back to the freshly parsed first block that held them, before any write installs it'
	},

	'src/lib/testing/container-conformance.ts': {
		count: 7,
		why: "the published kit's own fixture bytes, written into a throwaway parse"
	},
	'src/lib/testing/kind-conformance.ts': {
		count: 1,
		why: "the raw-write cell lands bytes that already crossed the kind's rule, in a throwaway parse"
	}
};

const BARE_WRITE_RULE =
	'a `<node>.raw =` write or an `installOwnRaw` call reaches a leaf’s bytes with no kind rule ' +
	'in front of it — the shape issue #45 shipped through. Route it through `writeOwnRaw` (in place) or `normalizeOwnRaw` ' +
	'(ahead of your own reparse), or add the file to BARE_RAW_WRITE_ALLOWLIST with its count and ' +
	'the reason its writes cannot reach a kind that declares one';

const sources = collectEditorSources();

describe('every bare raw write is allowed', () => {
	const writes = bareWrites(sources);

	it('no file outside the allowed set writes a leaf’s raw directly', () => {
		const unsanctioned = writes
			.filter((w) => !(w.relPath in BARE_RAW_WRITE_ALLOWLIST))
			.map((w) => w.relPath);
		expect([...new Set(unsanctioned)], BARE_WRITE_RULE).toEqual([]);
	});

	it('each allowed file holds exactly the writes its entry accounts for', () => {
		for (const [relPath, entry] of Object.entries(BARE_RAW_WRITE_ALLOWLIST)) {
			const found = writes.filter((w) => w.relPath === relPath).length;
			expect(
				found,
				`${relPath} holds ${found} bare raw writes, allowed for ${entry.count}: ${entry.why}`
			).toBe(entry.count);
		}
	});

	it('counts an install call outside the writers, and not their own call or its declaration', () => {
		const call = 'installOwnRaw(leaf, legal, grammar);';
		const declared = 'export function installOwnRaw(node: CstNode) {}\n// installOwnRaw(x)';
		expect(bareWrites([sourceFile('src/lib/x.ts', call)])).toEqual([{ relPath: 'src/lib/x.ts' }]);
		expect(
			bareWrites([sourceFile('src/lib/y.ts', declared), sourceFile(CONTENT_WRITE, call)])
		).toEqual([]);
	});
});

describeManifests(
	[
		{
			id: 'the fence rule has one implementation, and only its home names the reconciliation',
			matches: /\breconcileFenceWrite\b/,
			declared: { [FENCE_HOME]: 'the fencedCode write rule' },
			reason: 'the fence write is reconciled in one place; reach it through the kind’s write rule',
			hits: ['const out = reconcileFenceWrite(input);'],
			misses: ['const out = reconcileFenceWrites(input);', '// reconcileFenceWrite sizes it']
		},
		{
			id: 'exactly the documented sites name the escalation primitive',
			matches: /\bescalatedFenceLength\b/,
			declared: ESCALATION_SITES,
			reason: 'a new site sizes a fence run over a body: declare why it cannot use the write rule',
			hits: ['const run = escalatedFenceLength(body, marker, 3);'],
			misses: ['// escalatedFenceLength sizes the run']
		}
	],
	sources
);

describe('the fence rule has one implementation', () => {
	// The rule reads the block's own fence shape, so it has to live where a headless caller can
	// reach it: under `components/` it would exist only once the component tree loaded.
	it('the rule home is in schema, importing no component', () => {
		const home = sources.find((f) => f.relPath === FENCE_HOME);
		expect(home, `${FENCE_HOME} not found`).toBeDefined();
		expect(home!.code).not.toMatch(/from\s*['"][^'"]*components/);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('a mention inside a comment cannot satisfy the scan', () => {
		expect(/\bwriteOwnRaw\b/.test(stripComments('// calls writeOwnRaw one day\n', 'script'))).toBe(
			false
		);
		expect(/\bwriteOwnRaw\b/.test(stripComments('x = writeOwnRaw(n, r);\n', 'script'))).toBe(true);
	});
});
