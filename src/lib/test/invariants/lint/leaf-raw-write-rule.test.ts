/**
 * A kind's own raw-write rule (`normalizeRawWrite`) reaches its bytes through two functions,
 * `writeOwnRaw` in place and `normalizeOwnRaw` for a caller that reparses the result, and every
 * write to a leaf's raw that bypasses the kind's own component calls one (issues #45, #55). The
 * lists of sites make the next such write a decision; the allowlist of bare writes below makes a
 * write that names neither function one too.
 */

import { describe, it, expect } from 'vitest';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { collectEditorSources, rawAssignments, stripComments } from './scan-source';

const READERS_HOME = 'src/lib/tree-operations/node-primitives.ts';

/** Every file naming the capability in code, and why. */
const CAPABILITY_SITES: Record<string, string> = {
	'src/lib/schema/block-kind-descriptor.ts': 'the field declaration',
	'src/lib/schema/built-in-descriptors.ts': 'tableCell and fencedCode declare it',
	[READERS_HOME]: 'the readers dispatch it'
};

/** Every place that writes a leaf's raw in place and has to apply the kind's rule. */
const READER_SITES: Record<string, string> = {
	[READERS_HOME]: 'the reader itself',
	'src/lib/tree-operations/content-write.ts': 'the context-dependent-kind write',
	'src/lib/editor-actions/table-context.ts':
		'pasteGrid, writing each pasted cell text in place through the tableCell rule',
	'src/lib/editor-actions/search-replace.ts': 'substitutes into a private clone',
	'src/lib/selection/range-delete.ts': 'the same-block merge writes raw with no reparse',
	'src/lib/selection/selection-drop.ts':
		'a drop out of a table cell writes the cut cell text into a private clone of its table',
	'src/lib/selection/cross-block/type-replace.ts': 'the degraded arm splices raw',
	'src/lib/selection/cross-block/format-range.ts':
		'the per-block toggle writes display bytes with no reparse',
	'src/lib/tree-operations/paste/container-match.ts': 'splices clipboard text into the target leaf',
	'src/lib/editor-actions/inline-range-commit.ts':
		'the anchored inline editors splice a construct range with no reparse'
};

/**
 * Every place that replaces the leaf with a reparse of the bytes it built. The reparse re-derives
 * metadata, so the rule runs against the old node or the structure it would restore is gone.
 */
const PRE_REPARSE_SITES: Record<string, string> = {
	[READERS_HOME]: 'the reader itself',
	'src/lib/tree-operations/node-ops.ts':
		'the deep-leaf merge normalizes ahead of its fragment reparse',
	'src/lib/selection/range-delete.ts': 'the cross-block merge normalizes the end slice',
	'src/lib/selection/range-delete-ceremony.ts':
		'the endpoint-survivor reparse, shared by all three branches',
	'src/lib/editor-actions/inline-range-commit.ts':
		'reads the rule ahead of the write to decide whether the splice changes a byte at all'
};

/**
 * A branch inherits the rule by going through that shared reparse rather than naming either
 * function, which the per-file scan above cannot see. Rebuilding the reparse locally drops the
 * rule silently, so the inheritance is pinned on the helper's own name. The title and table
 * branches inherit one level higher, through the commit's whole-block truncation steps; a local
 * reparse grown back there re-enters this exact-set scan and fails it.
 */
const PRE_REPARSE_INHERITORS: Record<string, string> = {
	'src/lib/selection/range-delete-ceremony.ts':
		'defines it; the truncation atoms route every wall-branch endpoint through it',
	'src/lib/selection/range-delete.ts': 'the generic merge installs its survivor through it'
};

/** The fence rule has one implementation, shared by the display path and the byte write. */
const FENCE_HOME = 'src/lib/schema/fenced-code-raw.ts';
const FENCE_READERS: Record<string, string> = {
	[FENCE_HOME]: 'the implementation',
	'src/lib/components/blocks/code/CodeBlock.svelte': 'the display-commit funnel',
	'src/lib/components/blocks/code/code-paste.ts': 'the paste surface'
};

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

const CAPABILITY = /\bnormalizeRawWrite\b/;
const READER = /\bwriteOwnRaw\b/;
const PRE_REPARSE_READER = /\bnormalizeOwnRaw\b/;
const PRE_REPARSE_HELPER = /\breparseTruncatedEndpoint\b/;

function namesInCode(sources: { relPath: string; code: string }[], re: RegExp): string[] {
	return sources
		.filter((f) => re.test(f.code))
		.map((f) => f.relPath)
		.sort();
}

describe('the kind’s own raw-write rule runs at every byte sink', () => {
	const sources = collectEditorSources();

	it('inspected at least one editor source file', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it.each(['tableCell', 'fencedCode'] as const)('%s declares the capability', (kind) => {
		expect(typeof getBlockKindDescriptor(kind).normalizeRawWrite).toBe('function');
	});

	it('the readers live at their home and dispatch whatever the kind declared', () => {
		const home = sources.find((f) => f.relPath === READERS_HOME);
		expect(home, `${READERS_HOME} not found`).toBeDefined();
		expect(CAPABILITY.test(home!.code), 'the readers stopped dispatching the capability').toBe(
			true
		);
	});

	it('exactly the documented sites name the capability', () => {
		expect(namesInCode(sources, CAPABILITY)).toEqual(Object.keys(CAPABILITY_SITES).sort());
	});

	// Fails when a write site is added or removed, making the next one an explicit decision. A
	// bare `.raw =` write names neither function; the allowlist below is what catches those.
	it('exactly the documented sinks call the reader', () => {
		expect(namesInCode(sources, READER)).toEqual(Object.keys(READER_SITES).sort());
	});

	it('exactly the documented sinks normalize ahead of their own reparse', () => {
		expect(namesInCode(sources, PRE_REPARSE_READER)).toEqual(Object.keys(PRE_REPARSE_SITES).sort());
	});

	it('exactly the documented branches inherit the rule through the shared reparse', () => {
		expect(namesInCode(sources, PRE_REPARSE_HELPER)).toEqual(
			Object.keys(PRE_REPARSE_INHERITORS).sort()
		);
	});
});

// ── The bare write: a byte write that names neither function ─────────────────

/**
 * Files holding a `<node>.raw =` write that consults no kind rule, each with the count it is
 * allowed: an entry per file with no count would let the next write in unnoticed. An allowed write
 * is either a kind re-emitting its own bytes, or one that cannot reach a kind declaring a rule.
 */
const BARE_RAW_WRITE_ALLOWLIST: Record<string, { count: number; why: string }> = {
	[READERS_HOME]: { count: 1, why: 'the one allowed writer itself' },
	'src/lib/tree-operations/content-write.ts': {
		count: 5,
		why: 'the reparse path every write takes: each one is re-read from a parse, restores bytes the slot already held, or re-attaches the blank line that parse stripped (GH #97)'
	},
	'src/lib/tree-operations/node-ops.ts': {
		count: 4,
		why: 'the split and the single-block reparse re-attach the blank line that parse stripped (GH #97); both deep-leaf merge branches land bytes that already crossed `normalizeOwnRaw` and a fragment reparse (GH #54)'
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
	'src/lib/tree-operations/list/unwrap-merge.ts': {
		count: 1,
		why: 'the list-item merge target, which throws unless it is a paragraph'
	},
	'src/lib/tree-operations/list/terminator.ts': {
		count: 1,
		why: "appends the list's own line ending to the deepest node that owns its last line: the descent stops above a grid cell or an opaque body, whose bytes sit inside a line their container emits; an ending terminates a line rather than restructuring one"
	},
	'src/lib/testing/container-conformance.ts': {
		count: 5,
		why: "the published kit's own fixture bytes, written into a throwaway parse"
	}
};

const BARE_WRITE_RULE =
	'a `<node>.raw =` write reaches a leaf’s bytes with no kind rule in front of it — the shape ' +
	'issue #45 shipped through. Route it through `writeOwnRaw` (in place) or `normalizeOwnRaw` ' +
	'(ahead of your own reparse), or add the file to BARE_RAW_WRITE_ALLOWLIST with its count and ' +
	'the reason its writes cannot reach a kind that declares one';

describe('every bare raw write is sanctioned', () => {
	const writes = rawAssignments(collectEditorSources());

	it('no file outside the sanctioned set writes a leaf’s raw directly', () => {
		const unsanctioned = writes
			.filter((w) => !(w.relPath in BARE_RAW_WRITE_ALLOWLIST))
			.map((w) => w.relPath);
		expect([...new Set(unsanctioned)], BARE_WRITE_RULE).toEqual([]);
	});

	it('each sanctioned file holds exactly the writes its entry accounts for', () => {
		for (const [relPath, entry] of Object.entries(BARE_RAW_WRITE_ALLOWLIST)) {
			const found = writes.filter((w) => w.relPath === relPath).length;
			expect(
				found,
				`${relPath} holds ${found} bare raw writes, sanctioned for ${entry.count} — ${entry.why}`
			).toBe(entry.count);
		}
	});
});

describe('the fence rule has one implementation', () => {
	const sources = collectEditorSources();

	it('exactly the documented readers name the reconciliation', () => {
		expect(namesInCode(sources, /\breconcileFenceWrite\b/)).toEqual(
			Object.keys(FENCE_READERS).sort()
		);
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
		expect(READER.test(stripComments('// calls writeOwnRaw one day\n'))).toBe(false);
		expect(READER.test(stripComments('x = writeOwnRaw(n, r);\n'))).toBe(true);
	});
});
