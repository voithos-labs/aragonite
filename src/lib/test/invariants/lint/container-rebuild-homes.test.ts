/**
 * G4.96: a commit rebuilds each scope once, through its own chain rebuild, so a container rebuild
 * is called only where rebuilds live and from the files listed below. Each listed file's call
 * count is exact, so a mutation that rebuilds its own scope fails here even in a listed file.
 */

import { describe, it, expect } from 'vitest';
import { callSites, collectEditorSources, fileClasses, type SourceFile } from './scan-source';
import { probeFile } from './file-rule';

/** The rebuilds that name no kind: one node, one node's ancestry, a copied chain. */
const KIND_FREE = [
	'rebuildContainerRaw',
	'rebuildContainerRawIfContainer',
	'rebuildAncestryRaw',
	'rebuildOwnedContainer',
	'rebuildUnsharedChain',
	'rebuildUnsharedAncestry'
];

/** The built-in rebuilders the registration read below must find. */
const BUILT_IN_REBUILDERS = [
	'rebuildTableRaw',
	'rebuildTableRowRaw',
	'rebuildListRaw',
	'rebuildListItemRaw',
	'rebuildBlockquoteRaw'
];

/** Where the rebuilds themselves live. */
const HOMES = [
	'src/lib/schema/',
	'src/lib/tree-operations/chain-rebuild.ts',
	'src/lib/tree-operations/unshare.ts'
];

interface Pin {
	/** Calls per rebuild name: `.rebuild` is `ContainerScope.rebuild`, `.rebuildRaw` a descriptor call. */
	calls: Record<string, number>;
	why: string;
}

/** Every other file that rebuilds, with its exact call count and why no commit repeats it. */
const PINNED: Record<string, Pin> = {
	'src/lib/editor-actions/commit/undo-controller.ts': {
		calls: { rebuildUnsharedChain: 1, rebuildOwnedContainer: 1 },
		why: 'the commit’s own chain rebuild, and the scope’s `rebuild` it hands the mutation'
	},
	'src/lib/tree-operations/list/item-moves.ts': {
		calls: { '.rebuild': 2 },
		why: 'a Tab’s new sublist and a lifted item that took the blocks after it sit below the commit’s chain, which never rebuilds them, and the blank-line rule reads their bytes before the commit returns'
	},
	'src/lib/editor-actions/leaf-write.ts': {
		calls: { rebuildUnsharedChain: 1 },
		why: 'a keystroke written in place, which no commit follows'
	},
	'src/lib/editor-actions/block-edit-core.ts': {
		calls: { rebuildUnsharedChain: 1 },
		why: 'a metadata update rewrites a child below the scope, which the commit’s chain never reaches'
	},
	'src/lib/editor-actions/search-replace.ts': {
		calls: { rebuildUnsharedChain: 1, rebuildContainerRaw: 1 },
		why: 'rebuilds a scratch clone to read the replacement back before any commit'
	},
	'src/lib/selection/cross-block/format-range.ts': {
		calls: { rebuildUnsharedChain: 1 },
		why: 'the document scope has no chain, so each written leaf’s ancestors are rebuilt here'
	},
	'src/lib/selection/range-delete.ts': {
		calls: { rebuildUnsharedAncestry: 2 },
		why: 'the range delete rebuilds the joined start’s chain: the only rebuild under the top-level delete, a repeat of the commit’s scopes under the cross-container one, which keeps bytes and so writes the same (T18 slice 5 retires it)'
	},
	'src/lib/selection/range-delete-ceremony.ts': {
		calls: { rebuildUnsharedChain: 2 },
		why: 'the same range delete, for what is left of each removed subtree’s parents and a cleared title line’s container (T18 slice 5 retires it)'
	},
	'src/lib/selection/range-delete-chrome.ts': {
		calls: { rebuildUnsharedChain: 2 },
		why: 'the same range delete, for the endpoints it truncates without joining them (T18 slice 5 retires it)'
	},
	'src/lib/selection/range-delete-table.ts': {
		calls: { rebuildUnsharedChain: 2, rebuildTableRowRaw: 2 },
		why: 'the same range delete, for the rows a table edge clears (which keep their bytes) and each kept edge’s chain (T18 slice 5)'
	},
	'src/lib/selection/selection-drop.ts': {
		calls: { rebuildAncestryRaw: 1 },
		why: 'rebuilds a clone of the dragged cell’s table to measure the cut'
	},
	'src/lib/testing/container-conformance.ts': {
		calls: {
			rebuildUnsharedAncestry: 2,
			rebuildUnsharedChain: 1,
			rebuildContainerRawIfContainer: 1,
			'.rebuildRaw': 7
		},
		why: 'the conformance kit drives rebuilds directly, outside any commit'
	},
	'src/lib/testing/kind-conformance.ts': {
		calls: { '.rebuildRaw': 1 },
		why: 'the kind kit rebuilds a parsed fixture, outside any commit'
	},
	'src/lib/testing/conformance-core.ts': {
		calls: { '.rebuildRaw': 1 },
		why: 'the shared kit check rebuilds a parsed fixture, outside any commit'
	},
	'src/lib/selection/clipboard-text.ts': {
		calls: { '.rebuildRaw': 1 },
		why: 'a copy re-emits a synthetic container around the copied body, a node no commit has seen'
	},
	'src/lib/tree-operations/blockquote.ts': {
		calls: { rebuildContainerRaw: 2 },
		why: 'builds the quote left over after a lift, a node no commit has seen'
	},
	'src/lib/tree-operations/container-lift.ts': {
		calls: { rebuildContainerRaw: 1 },
		why: 'builds the container left over after a lift, a node no commit has seen'
	},
	'src/lib/tree-operations/content-write.ts': {
		calls: { rebuildContainerRaw: 4 },
		why: 'a reparse that backfilled an empty container, a new node below the scope'
	},
	'src/lib/tree-operations/list/list-builders.ts': {
		calls: { rebuildListItemRaw: 1, rebuildListRaw: 1 },
		why: 'builds new items and list halves, nodes no commit has seen'
	},
	'src/lib/tree-operations/list/ordered-markers.ts': {
		calls: { rebuildListItemRaw: 4 },
		why: 'a renumber rewrites items below the scope, keeping each line its new number still reads'
	},
	'src/lib/tree-operations/list/task-paragraph.ts': {
		calls: { rebuildListItemRaw: 1 },
		why: 'a trial item, read back once and dropped'
	},
	'src/lib/tree-operations/list/unwrap-merge.ts': {
		calls: { rebuildListRaw: 1 },
		why: 'an unwrap of an empty first item rebuilds the shrunk list, a clone no commit chain holds'
	},
	'src/lib/tree-operations/node-ops.ts': {
		calls: { rebuildAncestryRaw: 1 },
		why: 'a join rewrites the ancestors of the joined leaf below its parent'
	},
	'src/lib/tree-operations/paste/container-match.ts': {
		calls: { rebuildUnsharedChain: 2, rebuildContainerRaw: 1 },
		why: 'the merged leaf’s whole chain, which the paste’s commit rebuilds again from the scope up, writing the same bytes now that rebuilds keep them, and the last pasted item (T18 slice 6 retires it)'
	},
	'src/lib/tree-operations/paste/table-slice.ts': {
		calls: { rebuildTableRaw: 2 },
		why: 'builds the two halves of a split table'
	},
	'src/lib/tree-operations/sub-table-copy.ts': {
		calls: { rebuildTableRaw: 1 },
		why: 'builds the table a rectangular copy writes'
	},
	'src/lib/plugins/mermaid/mermaid-kind.ts': {
		calls: { rebuildMermaidRaw: 1 },
		why: 'the opener builds a new node’s bytes with its own rebuild'
	}
};

const REASON =
	'a mutation that rebuilds its scope or its chain has the commit rebuild it again; let the commit do it, rebuild an off-chain node through `ContainerScope.rebuild`, or pin the call with why';

// ── The scan ─────────────────────────────────────────────────────────────────

/** Every function a descriptor registers as its `rebuildRaw`, plus the kind-free rebuilds. */
function rebuildNames(sources: SourceFile[]): string[] {
	const names = new Set(KIND_FREE);
	for (const file of sources) {
		for (const m of file.code.matchAll(/\brebuildRaw\s*:\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
	}
	return [...names];
}

const CODE = 0;

/** Each rebuild call in code as its name and line, `scope.rebuild(...)` and `d.rebuildRaw(...)` too. */
function rebuildCalls(file: SourceFile, names: string[]): { name: string; line: number }[] {
	const classes = fileClasses(file);
	const found: { index: number; name: string }[] = [];
	for (const name of names) {
		for (const site of callSites(file.code, name)) {
			if (classes[site.index] === CODE) found.push({ index: site.index, name });
		}
	}
	for (const m of file.code.matchAll(/\.(rebuild|rebuildRaw)\s*(?:!|\?\.)?\s*\(/g)) {
		if (classes[m.index] === CODE) found.push({ index: m.index, name: `.${m[1]}` });
	}
	return found
		.sort((a, b) => a.index - b.index)
		.map(({ index, name }) => ({ name, line: file.code.slice(0, index).split('\n').length }));
}

function tally(calls: { name: string }[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const { name } of calls) counts[name] = (counts[name] ?? 0) + 1;
	return counts;
}

const sameCounts = (a: Record<string, number>, b: Record<string, number>): boolean =>
	Object.keys({ ...a, ...b }).every((name) => (a[name] ?? 0) === (b[name] ?? 0));

interface Report {
	/** `path:line name` for each call in a file the list leaves out. */
	unpinned: string[];
	/** A listed file whose calls differ from its counts, either way. */
	miscounted: string[];
}

function scan(sources: SourceFile[], names: string[]): Report {
	const unpinned: string[] = [];
	const found = new Map<string, Record<string, number>>();
	for (const file of sources) {
		if (HOMES.some((home) => file.relPath.startsWith(home))) continue;
		const calls = rebuildCalls(file, names);
		if (calls.length === 0) continue;
		found.set(file.relPath, tally(calls));
		if (!(file.relPath in PINNED)) {
			unpinned.push(...calls.map(({ name, line }) => `${file.relPath}:${line} ${name}`));
		}
	}
	const miscounted = Object.entries(PINNED)
		.filter(([relPath, pin]) => !sameCounts(found.get(relPath) ?? {}, pin.calls))
		.map(
			([relPath, pin]) =>
				`${relPath}: pinned ${JSON.stringify(pin.calls)}, found ${JSON.stringify(found.get(relPath) ?? {})}`
		);
	return { unpinned, miscounted };
}

describe('G4.96 a container is rebuilt where rebuilds live, or at a pinned site', () => {
	const sources = collectEditorSources();
	const names = rebuildNames(sources);
	const report = scan(sources, names);

	it('reads every built-in rebuilder off the registrations', () => {
		expect(names).toEqual(expect.arrayContaining(BUILT_IN_REBUILDERS));
	});

	it('no file outside the homes rebuilds without a pin', () => {
		expect(report.unpinned, REASON).toEqual([]);
	});

	it('each pinned file makes exactly its pinned calls', () => {
		expect(report.miscounted, REASON).toEqual([]);
	});

	it('the scan flags a call in a mutation and spares names that are not calls', () => {
		const flagged = (code: string, relPath = 'src/lib/editor-actions/probe.ts') =>
			scan([probeFile({ relPath, code })], names).unpinned.length > 0;
		expect(flagged('rebuildTableRaw(scope.node);')).toBe(true);
		expect(flagged('rebuildContainerRaw(scope.node, grammar);')).toBe(true);
		expect(flagged('destScope.rebuild(destScope.node);')).toBe(true);
		expect(flagged("import { rebuildTableRaw } from '../schema/container-rebuilders';")).toBe(
			false
		);
		expect(flagged("container: { contract: 'grid', rebuildRaw: rebuildTableRaw },")).toBe(false);
		expect(flagged("const via = 'rebuildTableRaw (grid)';\n// rebuildTableRaw(t)")).toBe(false);
		expect(flagged('descriptor.rebuildRaw!(node);')).toBe(true);
		expect(flagged('getBlockKindDescriptor(k).rebuildRaw(scope.node);')).toBe(true);
		expect(flagged('tryGetBlockKindDescriptor(k)?.rebuildRaw?.(scope.node);')).toBe(true);
		expect(flagged('const rebuild = descriptor.rebuildRaw;\nif (descriptor.rebuildRaw) {}')).toBe(
			false
		);
		expect(flagged('rebuildTableRaw(t);', 'src/lib/schema/probe.ts')).toBe(false);
	});

	it('one more call in a pinned file fails its count', () => {
		const relPath = 'src/lib/tree-operations/sub-table-copy.ts';
		const miscounted = (code: string) =>
			scan([probeFile({ relPath, code })], names).miscounted.some((l) => l.startsWith(relPath));
		expect(miscounted('rebuildTableRaw(a);')).toBe(false);
		expect(miscounted('rebuildTableRaw(a);\nrebuildTableRaw(b);')).toBe(true);
		expect(miscounted('rebuildTableRaw(a);\nrebuildContainerRaw(a, grammar);')).toBe(true);
	});
});
