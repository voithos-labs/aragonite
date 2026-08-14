/**
 * Every live gesture rule is a row in the inline-construct policy table, or an arm that names a
 * construct itself and says why (live-mode.md § 3). This census holds both sets: the arms reading
 * rows, and the ones still answering by hand — the second only ever shrinks, which the ratchet
 * below is. It also asserts the two-table boundary: rows answer hidden delimiter RUNS, the inline
 * widget registry answers atomic ISLANDS, and a file asking both states why.
 */

import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { EDITOR_SRC, collectEditorSources, stripComments, type SourceFile } from './scan-source';

/**
 * Where a live gesture can live: the block surfaces and the caret, selection, tree and view layers
 * they dispatch into. `core/` and `schema/` sit outside on purpose — the parser names every kind to
 * BUILD the tree, and the table's own registration site names every kind to declare its rows.
 */
const GESTURE_ROOTS = [
	'components',
	'cursor',
	'selection',
	'tree-operations',
	'decorations',
	'search',
	'ambient'
];

const POLICY_TABLE = 'src/lib/schema/inline-construct-policy.ts';
const WIDGET_REGISTRY = 'src/lib/core/inline/inline-widgets.ts';

// ── Matchers ─────────────────────────────────────────────────────────────────

/** Every door out of the policy table, the table's own module excluded. */
const POLICY_READ =
	/(?<![\w.])(getInlineConstructPolicy|getInlineMarkPolicy|inlineMarkForCommand|isCardEditableInlineKind|isRevealableInlineKind|listInlineConstructPolicies|listInlineMarks|getLiveSplitRebalancer|getLiveJoinSeamCleaner)\s*\(/;

const readsPolicyTable = (file: SourceFile): boolean =>
	file.relPath !== POLICY_TABLE && POLICY_READ.test(stripComments(file.text));

/** The widget registry's doors — the other table, whose subject is the atomic island. */
const WIDGET_READ =
	/(?<![\w.])(getInlineWidgetEditing|isInlineWidget|isInlineWidgetKind|widgetSourceRange|augmentInlineWidgetKind)\s*\(/;

const readsWidgetRegistry = (file: SourceFile): boolean =>
	file.relPath !== WIDGET_REGISTRY && WIDGET_READ.test(stripComments(file.text));

/** The kinds the table rows. A quoted literal is the tripwire: naming one in a gesture arm is
 *  answering a per-construct question the row exists to answer. */
const ROWED_KINDS = [
	'emphasis',
	'strong',
	'strikethrough',
	'inlineCode',
	'link',
	'image',
	'autolink',
	'escape',
	'hardLineBreak'
];

const KIND_LITERAL = new RegExp(`['"](${ROWED_KINDS.join('|')})['"]`);

const namesConstructKind = (file: SourceFile): boolean =>
	KIND_LITERAL.test(stripComments(file.text));

// ── The arms that read rows ──────────────────────────────────────────────────

/** Every reader of the table, and which column it is there for. Set equality both ways, so a new
 *  reader is a census conversation rather than a silent eighth opinion on a row's meaning. */
const POLICY_ARMS: Record<string, string> = {
	'src/lib/components/blocks/text/construct-edge-delete.ts':
		'the destructive arm: autoUnwrapOnEmpty',
	'src/lib/components/blocks/text/construct-reveal.ts': "preview-inline's reveal chain: revealable",
	'src/lib/components/blocks/text/edge-seat.ts': 'the typing seat: edgeAffinity',
	'src/lib/components/blocks/text/link-at-point.ts': 'the card entry: cardEditable',
	'src/lib/components/blocks/text/live-join-seam.ts':
		'the join cleaner: splitBehavior, and autoUnwrapOnEmpty for a construct the cut emptied',
	'src/lib/components/blocks/text/live-split-rebalance.ts': 'the split rebalancer: splitBehavior',
	'src/lib/components/blocks/text/format-toggle.ts': 'the toggle seam: the mark vocabulary',
	'src/lib/components/blocks/text/pending-mark-insert.ts':
		'the pending-mark resolver: edgeAffinity and the mark nesting order',
	'src/lib/components/blocks/table/TableCellBlock.svelte':
		'the cell surface: which mark a format command toggles',
	'src/lib/components/blocks/text/TextEditableBlock.svelte':
		'the prose surface: the same command lookup',
	'src/lib/schema/registration-checks.ts': 'the registration-time coherence check over every row',
	'src/lib/tree-operations/node-ops.ts': 'the one reader of both registered rewrite slots'
};

/** A file asking BOTH tables, and why it needs both answers. Only a block SURFACE legitimately
 *  does: it hosts every inline kind at once, so it meets the delimiter-run question and the
 *  atomic-island one on the same keystroke. An arm below a surface asking both is the boundary
 *  blurring, which is what this manifest is here to make visible. */
const BOTH_TABLE_READERS: Record<string, string> = {
	'src/lib/components/blocks/text/TextEditableBlock.svelte':
		'the prose surface: which mark a format command toggles, and whether a node is an island',
	'src/lib/components/blocks/table/TableCellBlock.svelte': 'the same pair on the cell surface'
};

// ── The arms that answer by hand ─────────────────────────────────────────────

interface HandWrittenArm {
	path: string;
	/** How the census sees it: a kind literal the scan finds, or a shape only a reader can. */
	detection: 'kind-literal' | 'declared';
	/** `backlog` is the ratchet's count. `deferred` names what blocks the row. `outside` is a
	 *  decision: the question is not the table's to answer. */
	fate: 'backlog' | 'deferred' | 'outside';
	reason: string;
}

const HAND_WRITTEN_ARMS: readonly HandWrittenArm[] = [
	{
		path: 'src/lib/components/blocks/text/construct-edge-delete.ts',
		detection: 'declared',
		fate: 'outside',
		reason:
			'which constructs it takes whole is a per-NODE fact: `[](u)` is a link with no content range, `![a](u)` an atomic island with one, so a kind column would swap both answers'
	},
	{
		path: 'src/lib/components/blocks/text/live-join-seam.ts',
		detection: 'declared',
		fate: 'outside',
		reason: 'the same per-node arity, in classifyConstructs, on the same two shapes'
	},
	{
		path: 'src/lib/components/blocks/text/edge-policy-dispatch.ts',
		detection: 'declared',
		fate: 'outside',
		reason:
			'a declared arm list, and never rows: this is a total order over gesture FAMILIES, where a row answers a per-construct question — the reading-mode cut is an entry in that order for the same reason'
	},
	{
		path: 'src/lib/components/blocks/text/link-source-bytes.ts',
		detection: 'kind-literal',
		fate: 'deferred',
		reason:
			'the link serializer wants a rewriteBytes row slot; blocked on making LinkFields kind-opaque first'
	},
	{
		path: POLICY_TABLE,
		detection: 'declared',
		fate: 'deferred',
		reason:
			'the no-residue rule is restated at four arms; single-sourcing it into the table folds into the slots-to-rows move'
	},
	{
		path: POLICY_TABLE,
		detection: 'declared',
		fate: 'deferred',
		reason:
			'the two rewrite slots hold one global function each rather than per-kind rows; moving them turns a register-once throw into a silent per-row degrade, so it needs the close-and-reopen producer assertion first'
	},
	{
		path: 'src/lib/components/built-in-blocks.ts',
		detection: 'kind-literal',
		fate: 'outside',
		reason:
			'the widget registry side of the two-table boundary: image as an atomic island, not a hidden delimiter run'
	},
	{
		path: 'src/lib/components/image/image-edit-commit.ts',
		detection: 'kind-literal',
		fate: 'outside',
		reason: 'the same island question, re-finding the widget an open editor is anchored to'
	}
];

/**
 * The backlog's high-water mark, now empty: every live gesture rule is a row, a decided `outside`,
 * or a `deferred` with what blocks it. It only ever decrements, so a commit that adds a
 * hand-written arm has to argue for it in review rather than absorb it into slack.
 */
const BACKLOG_CEILING = 0;

const backlog = HAND_WRITTEN_ARMS.filter((arm) => arm.fate === 'backlog');
const kindLiteralArms = HAND_WRITTEN_ARMS.filter((arm) => arm.detection === 'kind-literal');

// ── The census ───────────────────────────────────────────────────────────────

describe('inline-construct policy arm census', () => {
	const gestureSources = GESTURE_ROOTS.flatMap((root) =>
		collectEditorSources(path.join(EDITOR_SRC, root))
	);
	const allSources = collectEditorSources();
	const paths = (files: SourceFile[]) => files.map((file) => file.relPath).sort();
	const unique = (values: string[]) => [...new Set(values)].sort();

	it('every declared arm is on disk and reachable by the scan', () => {
		const declared = unique([
			...Object.keys(POLICY_ARMS),
			...HAND_WRITTEN_ARMS.map((arm) => arm.path)
		]);
		const onDisk = new Set(allSources.map((file) => file.relPath));
		expect(declared.filter((file) => !onDisk.has(file))).toEqual([]);
	});

	it('every reader of the policy table is declared with the column it reads', () => {
		expect(
			paths(allSources.filter(readsPolicyTable)),
			'a new file started reading the policy table: add it to POLICY_ARMS with the column it is there for'
		).toEqual(Object.keys(POLICY_ARMS).sort());
	});

	it('every gesture arm naming a construct kind is declared with its reason and fate', () => {
		expect(
			paths(gestureSources.filter(namesConstructKind)),
			'a gesture arm started naming a construct kind: give the question a row, or declare the arm in HAND_WRITTEN_ARMS with why it stays'
		).toEqual(unique(kindLiteralArms.map((arm) => arm.path)));
	});

	it('the hand-written backlog only ever shrinks', () => {
		expect(
			backlog.length,
			'the backlog grew: a new hand-written arm needs a row, not a bigger ceiling'
		).toBeLessThanOrEqual(BACKLOG_CEILING);
	});

	it('every declared arm carries a reason', () => {
		expect(HAND_WRITTEN_ARMS.filter((arm) => arm.reason.trim() === '')).toEqual([]);
		expect(Object.entries(POLICY_ARMS).filter(([, reason]) => reason.trim() === '')).toEqual([]);
	});

	// ── The two-table boundary ───────────────────────────────────────────────

	it('a file reading both tables is declared with why it needs both answers', () => {
		const both = allSources.filter((file) => readsPolicyTable(file) && readsWidgetRegistry(file));
		expect(
			paths(both),
			'a file started asking both tables: declare it in BOTH_TABLE_READERS with why one answer is not enough'
		).toEqual(Object.keys(BOTH_TABLE_READERS).sort());
	});

	// An empty intersection above proves the boundary only while both halves can see anything.
	it('both table matchers find readers, so the boundary is not an artifact of a dead matcher', () => {
		expect(allSources.filter(readsPolicyTable).length).toBeGreaterThan(0);
		expect(allSources.filter(readsWidgetRegistry).length).toBeGreaterThan(0);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	const probe = (matcher: (file: SourceFile) => boolean, text: string) =>
		matcher({ relPath: 'src/lib/components/blocks/text/probe.ts', text, code: '' });

	it('the policy matcher sees every door and skips a mention in prose', () => {
		expect(probe(readsPolicyTable, 'const p = getInlineConstructPolicy(node.kind);')).toBe(true);
		expect(probe(readsPolicyTable, 'if (isRevealableInlineKind(kind)) out.push(node);')).toBe(true);
		expect(probe(readsPolicyTable, 'getLiveJoinSeamCleaner()?.(join)')).toBe(true);
		expect(probe(readsPolicyTable, '// getInlineConstructPolicy(kind) is the door')).toBe(false);
		expect(probe(readsPolicyTable, 'const x = myGetInlineConstructPolicy(kind);')).toBe(false);
	});

	it('the widget matcher sees the registry doors and skips prose', () => {
		expect(probe(readsWidgetRegistry, 'getInlineWidgetEditing(widget.kind)?.revealSource')).toBe(
			true
		);
		expect(probe(readsWidgetRegistry, 'if (isInlineWidget(node)) return null;')).toBe(true);
		expect(probe(readsWidgetRegistry, '/* widgetSourceRange(el) answers */')).toBe(false);
	});

	it('the kind matcher sees a literal in either quote and skips a dotted command id', () => {
		expect(
			probe(namesConstructKind, "if (node.kind === 'inlineCode') return codeWrap(slice);")
		).toBe(true);
		expect(probe(namesConstructKind, 'const MARKS = ["strong", "emphasis"];')).toBe(true);
		// The nearby spellings that are NOT a per-construct answer: a command id, a DOM tag read,
		// and the same word in prose.
		expect(probe(namesConstructKind, "if (id === 'format.toggleStrong') return toggle();")).toBe(
			false
		);
		expect(probe(namesConstructKind, "el.querySelector('strong > em')")).toBe(false);
		expect(probe(namesConstructKind, '// a link never extends at its edges')).toBe(false);
	});

	it('an undeclared gesture arm naming a kind fails the set equality', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/components/blocks/text/rogue.ts',
			text: "if (node.kind === 'strikethrough') return null;",
			code: ''
		};
		expect(paths([...gestureSources, rogue].filter(namesConstructKind))).not.toEqual(
			unique(kindLiteralArms.map((arm) => arm.path))
		);
	});

	it('an undeclared policy reader fails the set equality', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/selection/rogue.ts',
			text: 'const p = getInlineConstructPolicy(kind);',
			code: ''
		};
		expect(paths([...allSources, rogue].filter(readsPolicyTable))).not.toEqual(
			Object.keys(POLICY_ARMS).sort()
		);
	});
});
