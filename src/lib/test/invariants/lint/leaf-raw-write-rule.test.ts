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

const READERS_HOME = 'src/lib/tree-operations/node-primitives.ts';
const CONTENT_WRITE = 'src/lib/tree-operations/content-write.ts';

/** The fence rule has one implementation, which only the kinds' write rules reach. */
const FENCE_HOME = 'src/lib/schema/fenced-code-raw.ts';

/** Every site sizing a fence run over a body, which is a wider set than the write rule. */
const ESCALATION_SITES: Record<string, string> = {
	'src/lib/core/parsers/fence-syntax.ts': 'the grammar leaf that defines it',
	[FENCE_HOME]: 'the fencedCode write rule',
	'src/lib/tree-operations/content-write.ts':
		'sizes the terminator the content write mints for a construct it left open (GH #180)',
	'src/lib/debug/diagnostics-report.ts':
		'sizes the section fences of a field report whose bodies routinely carry fences of their own',
	'src/lib/plugins/mermaid/mermaid-kind.ts':
		'sizes the fence its metadata body is rebuilt inside — the body is never re-parsed here',
	'src/lib/plugin.ts': 'the author barrel: a plugin rebuilding its own raw needs the same rule'
};

function namesInCode(sources: { relPath: string; code: string }[], re: RegExp): string[] {
	return sources
		.filter((f) => re.test(f.code))
		.map((f) => f.relPath)
		.sort();
}

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
	'src/lib/tree-operations/settle.ts': {
		count: 1,
		why: 'the join absorb re-attaches the blank run its own reparse stripped (GH #61)'
	},
	'src/lib/schema/container-rebuilders.ts': {
		count: 2,
		why: 'the table grid re-emits its own bytes from its rows (G4.20 branch 3 reads the same writes)'
	},
	'src/lib/schema/child-spans.ts': {
		count: 4,
		why: 'the strip and concat container shapes re-emitting their own bytes from their children: the two span-seeding rebuilds, the whole-body fallback, and the one-region splice'
	},
	'src/lib/core/directive/kinds.ts': { count: 1, why: "the directive container's own rebuildRaw" },
	'src/lib/editor-actions/plugin/directive-container.ts': {
		count: 1,
		why: 'the titled-directive rebuildRaw factory'
	},
	'src/lib/plugins/admonitions/github-alert-kind.ts': {
		count: 2,
		why: "the alert's own rebuildRaw, empty-body and filled branches"
	},
	'src/lib/plugins/details/details-kind.ts': {
		count: 1,
		why: "the details container's rebuildRaw"
	},
	'src/lib/plugins/footnotes/footnote-definition.ts': {
		count: 1,
		why: "the definition's own rebuildRaw"
	},
	'src/lib/plugins/mermaid/mermaid-kind.ts': {
		count: 1,
		why: 'the mermaid leaf re-emits its fence from its own metadata: for its bytes, the kind is itself the rule'
	},
	'examples/consumer/src/routes/dev-guard/dev-probe.ts': {
		count: 1,
		why: "the reference plugin's own rebuildRaw"
	},
	'src/lib/editor-actions/search-replace.ts': {
		count: 1,
		why: 'find and replace installs the bytes `legalizeWrite` returned into a private copy, which it then reparses whole'
	},
	'src/lib/editor-actions/commit/undo-controller.ts': {
		count: 1,
		why: 'the rollback restores raws the tree already held; nothing new is created'
	},
	'src/lib/selection/range-delete-ceremony.ts': {
		count: 4,
		why: 'the chrome-clear and the truncation atoms’ two chrome-endpoint branches, reserved-chrome slots no leaf kind declaring a rule can occupy; and the endpoint reparse re-attaching the blank line that parse stripped (GH #97)'
	},
	'src/lib/selection/range-delete-table.ts': {
		count: 2,
		why: 'two cell clears; a cleared cell is empty, which `tableCell`’s own rule already returns unchanged'
	},
	'src/lib/tree-operations/list/reconcile-task.ts': {
		count: 2,
		why: "moves the task marker between the item's metadata and its first paragraph, kind-guarded to paragraph"
	},
	'src/lib/tree-operations/open-tail.ts': {
		count: 1,
		why: "adds or drops the ending of a block's last line in each node down to the one that owns it: the descent stops above a grid cell or an opaque body, whose bytes sit inside a line their container emits, and an opaque container re-reads its metadata after the write; an ending terminates a line rather than restructuring one"
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

describe('every bare raw write is allowed', () => {
	const writes = bareWrites(collectEditorSources());

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

describe('the fence rule has one implementation', () => {
	const sources = collectEditorSources();

	it('only its home names the reconciliation', () => {
		expect(namesInCode(sources, /\breconcileFenceWrite\b/)).toEqual([FENCE_HOME]);
	});

	it('exactly the documented sites name the escalation primitive', () => {
		expect(namesInCode(sources, /\bescalatedFenceLength\b/)).toEqual(
			Object.keys(ESCALATION_SITES).sort()
		);
	});

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
