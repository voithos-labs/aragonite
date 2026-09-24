/**
 * The conformance kit for an inline syntax handler (`InlineRung`), published at
 * `@voithos-labs/aragonite/testing` alongside `runKindConformance` and the container kit. It
 * reads the live registry, so it works across `resetPluginPlatformForTests()` cycles. The four
 * cells a profile declares are required, not optional, because byte round-trip cannot see any of
 * them, and where the kit can disprove an exemption it does. Failures throw a plain `Error`.
 */

import {
	isBuiltinInlineKind,
	type AnyInlineKind,
	type ImageFields,
	type InlineNode
} from '../core/nodes';
import { parse } from '../core/parser';
import { serialize } from '../core/serializer';
import { parseInline } from '../core/inline';
import { renderInlineNodes } from '../core/inline-render';
import {
	buildCoreInlineWidget,
	getInlineWidgetComponent,
	getInlineWidgetEditing,
	isInlineWidget,
	DELETE_GRANULARITIES,
	ON_EDGE_POLICIES,
	type InlineWidgetEditingPolicy
} from '../core/inline/inline-widgets';
import {
	INLINE_PRIORITIES,
	getInlineRungs,
	isReservedInlineTrigger,
	isScanProbeTrigger,
	type InlineRung
} from '../core/inline/scan/plugin-syntax';
import { containerDomTextLength } from '../cursor/widget-offset';
import {
	assert,
	assertExemptionDocumented,
	assertIs,
	fail,
	type ConformanceCoverage
} from './conformance-core';
import { defaultGrammarView } from '../schema/block-openers';

// ── Profile ──────────────────────────────────────────────────────────────────

export interface InlineConformanceProfile {
	/** The single character the handler registered on. */
	trigger: string;
	/** The handler's multi-character prefix. Omit for a bare-trigger registration. */
	prefix?: string;
	/** Tells two handlers apart when they share a prefix on one trigger at different priorities. */
	priority?: number;
	/**
	 * The inline kind the handler creates as its own. Omit for a handler that only creates
	 * built-in kinds over its own bytes (the `![[…]]`-as-`image` shape).
	 */
	kind?: AnyInlineKind;
	/** Single-line sources the handler claims. Non-empty: every other cell reads their nodes. */
	fixtures: string[];
	/**
	 * Single-line sources whose bytes the handler's prefix matches but a built-in construct (or
	 * an earlier handler) owns. Required when `overlapDecline` asserts.
	 */
	overlapFixtures?: string[];
	overlapDecline: ConformanceCoverage;
	widget: ConformanceCoverage;
	editingPolicy: ConformanceCoverage;
	imageClaim: ConformanceCoverage;
}

// ── Report ───────────────────────────────────────────────────────────────────

export type InlineConformanceCell =
	| 'claims'
	| 'roundTrip'
	| 'overlapDecline'
	| 'widget'
	| 'editingPolicy'
	| 'imageClaim'
	| 'registration';

export interface InlineCellReport {
	cell: InlineConformanceCell;
	status: 'asserted' | 'exempt' | 'boundary';
	/** Why a cell was excused, or which mechanism an asserted cell drove. */
	detail?: string;
}

export interface InlineConformanceReport {
	trigger: string;
	prefix: string;
	cells: InlineCellReport[];
}

// ── Runner ───────────────────────────────────────────────────────────────────

/**
 * A detail line for a cell that ran, or an explicit status. A check that skipped its work says
 * `boundary`: reporting `asserted` where nothing ran is the silent skip these statuses exist to
 * refuse.
 */
type CellOutcome = string | { status: 'asserted' | 'boundary'; detail: string };

/**
 * Runs every conformance cell for the registered handler the profile names. Returns the coverage
 * report, or throws an `Error` naming every failed cell.
 */
export function runInlineKindConformance(
	profile: InlineConformanceProfile
): InlineConformanceReport {
	const prefix = profile.prefix ?? profile.trigger;
	validateProfile(profile, prefix);

	const rung = locateRung(profile, prefix);
	const cells: InlineCellReport[] = [];
	const failures: string[] = [];

	const runCell = (
		cell: InlineConformanceCell,
		coverage: ConformanceCoverage,
		assertion: () => CellOutcome
	) => {
		try {
			if (coverage.mode === 'assert') {
				const outcome = assertion();
				cells.push(
					typeof outcome === 'string'
						? { cell, status: 'asserted', detail: outcome }
						: { cell, ...outcome }
				);
			} else {
				assertExemptionDocumented(coverage, `${prefix} ${cell}`);
				falsifyExcuse(cell, profile, rung);
				cells.push({ cell, status: coverage.mode, detail: coverage.reason });
			}
		} catch (error) {
			failures.push(`${cell}: ${(error as Error).message}`);
		}
	};

	runCell('claims', { mode: 'assert' }, () => checkClaimsItsFixtures(profile, rung));
	runCell('roundTrip', { mode: 'assert' }, () => checkRoundTrip(profile, rung));
	runCell('overlapDecline', profile.overlapDecline, () => checkOverlapDecline(profile, rung));
	runCell('widget', profile.widget, () => checkWidgetAtomicity(profile, rung));
	runCell('editingPolicy', profile.editingPolicy, () => checkEditingPolicy(profile, rung));
	runCell('imageClaim', profile.imageClaim, () => checkImageClaimStamp(profile, rung));
	runCell('registration', { mode: 'assert' }, () =>
		checkRegistrationHygiene(profile, prefix, rung)
	);

	if (failures.length > 0) {
		fail(`inline conformance failed for rung "${prefix}":\n  - ${failures.join('\n  - ')}`);
	}
	return { trigger: profile.trigger, prefix, cells };
}

// ── Profile validation + handler lookup ──────────────────────────────────────

function validateProfile(profile: InlineConformanceProfile, prefix: string): void {
	assertIs(profile.trigger.length, 1, 'trigger is a single character');
	assert(
		prefix.startsWith(profile.trigger),
		`prefix ${JSON.stringify(prefix)} begins with the trigger ${JSON.stringify(profile.trigger)}`
	);
	assert(profile.fixtures.length > 0, 'the profile supplies at least one fixture the rung claims');
	for (const fixture of profile.fixtures) assertSingleLine(fixture, 'fixture');

	// A prefix handler is consulted before the built-in case it shadows, so the overlap
	// always exists and there is nothing to excuse.
	if (isReservedInlineTrigger(profile.trigger) && profile.overlapDecline.mode !== 'assert') {
		fail(
			`${JSON.stringify(profile.trigger)} is claimed by the built-in scanner, so this rung is ` +
				`consulted ahead of it and MUST decline the overlap — overlapDecline cannot be ` +
				`${profile.overlapDecline.mode} on a reserved trigger`
		);
	}
	if (profile.overlapDecline.mode === 'assert') {
		assert(
			(profile.overlapFixtures?.length ?? 0) > 0,
			'overlapDecline asserts but the profile supplies no overlapFixtures'
		);
	}
	for (const fixture of profile.overlapFixtures ?? []) assertSingleLine(fixture, 'overlap fixture');
}

function assertSingleLine(source: string, label: string): void {
	assert(source.length > 0, `${label} is non-empty`);
	assert(
		!source.includes('\n'),
		`${label} ${JSON.stringify(source)} is a single line — the kit interleaves it into block contexts`
	);
}

function locateRung(profile: InlineConformanceProfile, prefix: string): InlineRung {
	const matches = getInlineRungs(profile.trigger).filter(
		(r) =>
			r.prefix === prefix && (profile.priority === undefined || r.priority === profile.priority)
	);
	if (matches.length === 0) {
		fail(
			`no rung is registered on ${JSON.stringify(profile.trigger)} at prefix ` +
				`${JSON.stringify(prefix)}${profile.priority === undefined ? '' : `, priority ${profile.priority}`} — ` +
				`register the plugin before running the kit, and check nothing else claimed the trigger first`
		);
	}
	if (matches.length > 1) {
		fail(
			`${matches.length} rungs share prefix ${JSON.stringify(prefix)} on ` +
				`${JSON.stringify(profile.trigger)} — name the rung's priority in the profile`
		);
	}
	return matches[0];
}

// ── Claim resolution ─────────────────────────────────────────────────────────

/**
 * Every node this handler produced from `source`, in document order. Ownership is read two ways,
 * because a handler's own kind carries no mark by design: either the declared kind, or the claim
 * the scan marks on a built-in kind produced over the handler's bytes.
 */
function mintedNodes(
	source: string,
	profile: InlineConformanceProfile,
	rung: InlineRung
): InlineNode[] {
	const out: InlineNode[] = [];
	const visit = (nodes: InlineNode[]) => {
		for (const node of nodes) {
			if (node.kind === profile.kind || node.syntaxClaim?.prefix === rung.prefix) out.push(node);
			else if (node.children) visit(node.children);
		}
	};
	visit(parseInline(source, 0, source.length));
	return out;
}

/**
 * Every claim in a fixture, or a failure naming it. A fixture may carry more than one
 * (`see [^a] and [^b]`), and every cell below goes through all of them.
 */
function claimsIn(
	fixture: string,
	profile: InlineConformanceProfile,
	rung: InlineRung
): InlineNode[] {
	const minted = mintedNodes(fixture, profile, rung);
	assert(
		minted.length > 0,
		`fixture ${JSON.stringify(fixture)} is not claimed by the "${rung.prefix}" rung — ` +
			`the kit would enroll the rung without exercising it`
	);
	return minted;
}

// ── claims ───────────────────────────────────────────────────────────────────

function checkClaimsItsFixtures(profile: InlineConformanceProfile, rung: InlineRung): string {
	let claims = 0;
	for (const fixture of profile.fixtures) {
		for (const node of claimsIn(fixture, profile, rung)) {
			assert(node.end > node.start, `the claim over ${JSON.stringify(fixture)} advances`);
			assert(
				node.start >= 0 && node.end <= fixture.length,
				`the claim over ${JSON.stringify(fixture)} stays inside the source`
			);
			assert(
				fixture.startsWith(rung.prefix, node.start),
				`the claim over ${JSON.stringify(fixture)} starts at the rung's own prefix`
			);
			claims++;
		}
	}
	return `${claims} claim(s) across ${profile.fixtures.length} fixture(s)`;
}

// ── roundTrip ────────────────────────────────────────────────────────────────

/**
 * The neighbours a handler's `end` arithmetic tends to get wrong: a construct starting where the
 * claim ended, the handler's own trigger on either edge, a wrapper competing for the bytes.
 */
function interleavings(fixture: string, trigger: string): string[] {
	return [
		fixture,
		`before ${fixture} after`,
		`${fixture} ${fixture}`,
		`${fixture}${fixture}`,
		`*${fixture}*`,
		`\`${fixture}\``,
		`[${fixture}](https://example.com)`,
		`> ${fixture}`,
		`${trigger}${fixture}`,
		`${fixture}${trigger}`
	];
}

/**
 * How far into `fixture` its own opener ends. Cutting a scan range there leaves the last
 * consultation on a prefix whose closer is out of range, which is what a heading's excluded `#`
 * run does to any construct straddling it.
 */
function openerWidth(fixture: string, prefix: string): number {
	const at = fixture.indexOf(prefix);
	return at < 0 ? prefix.length : at + prefix.length;
}

function checkRoundTrip(profile: InlineConformanceProfile, rung: InlineRung): string {
	let count = 0;
	for (const fixture of profile.fixtures) {
		for (const source of interleavings(fixture, profile.trigger)) {
			const withEnding = `${source}\n`;
			assertIs(
				serialize(parse(withEnding)),
				withEnding,
				`serialize(parse(source)) round-trips ${JSON.stringify(withEnding)}`
			);
			assertScanTiles(source, source.length);

			// Scan ranges that stop short of the raw (a heading's excluded `#` run, a table
			// cell's `|`): the tail is real grammar, so a terminator search written without
			// an `end` bound reaches into it. Two cut points because where the boundary falls
			// relative to a construct is the variable.
			assertScanTiles(source + fixture, source.length);
			assertScanTiles(source + fixture, source.length + openerWidth(fixture, rung.prefix));
			count++;
		}
	}
	return `${count} source(s) round-trip byte-for-byte and tile their scan range`;
}

/**
 * `serialize(parse(s))` works from the raw bytes and never sees a handler at all, so what a
 * handler can break is the scanner's contract: the nodes cover `[0, end)` with no gap or overlap,
 * and their slices reassemble the scanned bytes. An overrun past `end` never reaches here,
 * because the dispatch throws on it (`scan/index.ts`).
 */
function assertScanTiles(raw: string, end: number): void {
	const nodes = parseInline(raw, 0, end);
	let cursor = 0;
	for (const node of nodes) {
		assertIs(
			node.start,
			cursor,
			`the scan of ${JSON.stringify(raw.slice(0, end))} tiles without a gap or overlap at ${cursor}`
		);
		cursor = node.end;
	}
	assertIs(cursor, end, `the scan of ${JSON.stringify(raw.slice(0, end))} covers its whole range`);
	assertIs(
		nodes.map((n) => raw.slice(n.start, n.end)).join(''),
		raw.slice(0, end),
		`the scanned spans of ${JSON.stringify(raw.slice(0, end))} reassemble its bytes`
	);
}

// ── overlapDecline ───────────────────────────────────────────────────────────

/**
 * At every position the scan would consult this handler, the recognizer returns null. Declining
 * leaves the scan state untouched, so declining everywhere is what guarantees the built-in
 * construct sees byte-identical input.
 */
function checkOverlapDecline(profile: InlineConformanceProfile, rung: InlineRung): string {
	const fixtures = profile.overlapFixtures ?? [];
	let consulted = 0;
	for (const source of fixtures) {
		let positions = 0;
		for (let pos = 0; pos < source.length; pos++) {
			if (!source.startsWith(rung.prefix, pos)) continue;
			positions++;
			const claimed = rung.recognizer(source, pos, source.length, defaultGrammarView);
			if (claimed !== null) {
				fail(
					`the "${rung.prefix}" rung swallowed the overlap in ${JSON.stringify(source)} at ` +
						`offset ${pos} — it claimed [${claimed.start}, ${claimed.end}) as "${claimed.kind}", ` +
						`so the built-in construct those bytes spell never reaches the scanner`
				);
			}
		}
		assert(
			positions > 0,
			`overlap fixture ${JSON.stringify(source)} never presents the rung's prefix ` +
				`${JSON.stringify(rung.prefix)} — it exercises no overlap`
		);
		consulted += positions;

		const minted = mintedNodes(source, profile, rung);
		assertIs(
			minted.length,
			0,
			`the parse of ${JSON.stringify(source)} holds no node the "${rung.prefix}" rung claimed`
		);

		const withEnding = `${source}\n`;
		assertIs(
			serialize(parse(withEnding)),
			withEnding,
			`the declined overlap ${JSON.stringify(withEnding)} round-trips`
		);
	}
	return `${consulted} prefix position(s) declined across ${fixtures.length} overlap fixture(s)`;
}

// ── widget ───────────────────────────────────────────────────────────────────

const NO_DOM =
	'no DOM in this environment — the island half of the widget cell needs one; run this ' +
	'suite under jsdom/happy-dom (Vitest: a `// @vitest-environment jsdom` docblock)';

const RECOGNITION_HALF = 'recognition + self-delimiting claim';

function checkWidgetAtomicity(profile: InlineConformanceProfile, rung: InlineRung): CellOutcome {
	const kind = profile.kind;
	assert(
		kind !== undefined,
		'the widget cell asserts but the profile names no kind — a rung minting only built-in ' +
			'kinds renders through the built-in widget and declares this cell exempt'
	);

	for (const fixture of profile.fixtures) {
		for (const node of claimsIn(fixture, profile, rung)) {
			assert(
				isInlineWidget(node, fixture, defaultGrammarView),
				`the "${kind}" node from ${JSON.stringify(fixture)} is a registered live widget`
			);
			assertSelfDelimiting(fixture, node, kind);
		}
	}

	// Both early exits report boundary, not asserted: the inline-widget contract did not run.
	if (getInlineWidgetComponent(kind, defaultGrammarView) !== undefined) {
		return {
			status: 'boundary',
			detail:
				`${RECOGNITION_HALF} executed; the widget wrapper of a \`component\` kind is created by ` +
				`the render layer, not by the plugin, so it is not the plugin’s to get wrong`
		};
	}
	if (typeof document === 'undefined') {
		return { status: 'boundary', detail: `${RECOGNITION_HALF} executed: ${NO_DOM}` };
	}

	for (const fixture of profile.fixtures) {
		for (const node of claimsIn(fixture, profile, rung)) {
			assertIslandContract(fixture, node, kind);
		}
		assertWalkLengthIsRawLength(fixture);
	}
	return 'recognition, self-delimiting claim, island contract, and offset-walk length';
}

/**
 * The claimed bytes have to stand alone: `data-source-*` hands exactly this slice to the clipboard
 * and to a source view, and a slice that only forms in its original context pastes back as broken
 * prose while the document it came from round-trips perfectly.
 */
function assertSelfDelimiting(fixture: string, node: InlineNode, kind: AnyInlineKind): void {
	const slice = fixture.slice(node.start, node.end);
	const alone = parseInline(slice, 0, slice.length);
	const first = alone[0];
	assert(
		first !== undefined && first.kind === kind && first.start === 0 && first.end === slice.length,
		`the claimed slice ${JSON.stringify(slice)} re-forms as a whole "${kind}" on its own — ` +
			`the bytes data-source-* hands the clipboard and the reveal`
	);
}

function assertIslandContract(fixture: string, node: InlineNode, kind: AnyInlineKind): void {
	const island = buildCoreInlineWidget(node, fixture, undefined, defaultGrammarView);
	assert(island !== null, `the "${kind}" widget builds an island from ${JSON.stringify(fixture)}`);
	assert(
		island.hasAttribute('data-inline-widget'),
		`the "${kind}" island carries [data-inline-widget] — the offset walk's only handle`
	);
	assertIs(
		island.getAttribute('contenteditable'),
		'false',
		`the "${kind}" island is contenteditable=false`
	);
	assertIs(
		Number(island.getAttribute('data-source-start')),
		node.start,
		`the "${kind}" island's data-source-start is the node's own offset`
	);
	assertIs(
		Number(island.getAttribute('data-source-end')),
		node.end,
		`the "${kind}" island's data-source-end is the node's own offset`
	);
}

/**
 * The DOM-to-offset traversal counts a widget as its source span, never as what it renders: an
 * emoji showing one glyph for seven raw bytes still counts seven. Every caret offset in the block
 * depends on this, and nothing in the bytes shows when it is wrong.
 */
function assertWalkLengthIsRawLength(fixture: string): void {
	const container = document.createElement('div');
	container.appendChild(
		renderInlineNodes(parseInline(fixture, 0, fixture.length), fixture, {
			grammar: defaultGrammarView
		})
	);
	assertIs(
		Number(containerDomTextLength(container)),
		fixture.length,
		`the offset walk over the rendered ${JSON.stringify(fixture)} measures its raw length`
	);
}

// ── editingPolicy ────────────────────────────────────────────────────────────

/**
 * A policy field outside the caret-edge dispatch's vocabulary is read as absent and the
 * kind silently takes the default, with no byte differing.
 */
function checkEditingPolicy(profile: InlineConformanceProfile, rung: InlineRung): string {
	const kind = profile.kind;
	assert(kind !== undefined, 'the editingPolicy cell asserts but the profile names no kind');
	const policy = getInlineWidgetEditing(kind, defaultGrammarView);
	assert(
		policy !== undefined,
		`"${kind}" declares no editing policy — register one, or declare this cell exempt if the ` +
			`widget takes the default select-then-delete behavior deliberately`
	);
	// An all-absent object is what the dispatch reads as no policy, so accepting one lets a kind
	// clear the cell with a declaration that changes not one byte of behavior.
	assert(
		Object.values(policy).some((field) => field !== undefined),
		`"${kind}" registers an editing policy with every field absent, which the caret-edge ` +
			`dispatch reads exactly as no policy at all — declare a field, or declare this cell exempt`
	);
	assertPolicyVocabulary(policy, kind);

	if (policy.deleteGranularity === 'atomic') {
		for (const fixture of profile.fixtures) {
			// One keypress deletes one widget, so each claim is removed on its own.
			for (const node of claimsIn(fixture, profile, rung)) {
				const excised = `${fixture.slice(0, node.start)}${fixture.slice(node.end)}\n`;
				assertIs(
					serialize(parse(excised)),
					excised,
					`the one-press whole-delete of the claim at ${node.start} in ` +
						`${JSON.stringify(fixture)} leaves bytes that round-trip`
				);
			}
		}
		return 'policy vocabulary + atomic whole-delete leaves round-tripping bytes';
	}
	return 'policy vocabulary';
}

function assertPolicyVocabulary(policy: InlineWidgetEditingPolicy, kind: AnyInlineKind): void {
	if (policy.revealSource !== undefined) {
		assertIs(typeof policy.revealSource, 'boolean', `"${kind}" revealSource is a boolean`);
	}
	if (policy.deleteGranularity !== undefined) {
		assert(
			DELETE_GRANULARITIES.includes(policy.deleteGranularity),
			`"${kind}" deleteGranularity is one of ${DELETE_GRANULARITIES.join(' | ')}`
		);
	}
	if (policy.onEdge !== undefined) {
		assert(
			ON_EDGE_POLICIES.includes(policy.onEdge),
			`"${kind}" onEdge is one of ${ON_EDGE_POLICIES.join(' | ')}`
		);
	}
	if (policy.onSelectedKey !== undefined) {
		assertIs(typeof policy.onSelectedKey, 'function', `"${kind}" onSelectedKey is callable`);
	}
	if (policy.claimsActivationClick !== undefined) {
		assertIs(
			typeof policy.claimsActivationClick,
			'boolean',
			`"${kind}" claimsActivationClick is a boolean`
		);
	}
}

// ── imageClaim ───────────────────────────────────────────────────────────────

/**
 * A handler that produces a built-in kind borrows the editor's model for bytes of its own, and
 * the editor writes that model back out as built-in grammar, so without `rewriteImage` a resize
 * turns `![[cat.png|300]]` into GFM. The document round-trips the whole time; it is just a
 * different document.
 */
function checkImageClaimStamp(profile: InlineConformanceProfile, rung: InlineRung): string {
	let stamped = 0;
	for (const fixture of profile.fixtures) {
		for (const node of mintedNodes(fixture, profile, rung)) {
			if (node.kind === profile.kind) {
				assertIs(
					node.syntaxClaim,
					undefined,
					`the rung's own "${node.kind}" is left unstamped — nothing outside the plugin ` +
						`could re-serialize it, so the stamp would have no reader`
				);
				continue;
			}
			assert(
				isBuiltinInlineKind(node.kind),
				`the claimed "${node.kind}" node is a built-in kind the scan stamps`
			);
			assertIs(
				node.syntaxClaim?.prefix,
				rung.prefix,
				`the built-in "${node.kind}" minted over the rung's bytes carries its claim`
			);
			stamped++;
			if (node.kind === 'image') assertRewriteReproducesSource(fixture, node, rung);
		}
	}
	assert(
		stamped > 0,
		`imageClaim asserts but no fixture mints a built-in kind — declare the cell exempt if the ` +
			`rung mints only its own kind`
	);
	return `${stamped} built-in node(s) stamped, rewriteImage reproduces its own input`;
}

/**
 * The hook has to re-emit the node it was handed, unedited. The commit drops a byte-identical
 * result without warning, so a hook that cannot reproduce its own input shows up as an edit that
 * silently does nothing.
 */
function assertRewriteReproducesSource(fixture: string, node: InlineNode, rung: InlineRung): void {
	assert(
		rung.rewriteImage !== undefined,
		`the "${rung.prefix}" rung mints a built-in image but registers no rewriteImage — every ` +
			`image edit on it is declined, and without the hook the editor would write GFM over ` +
			`the rung's own syntax`
	);
	const source = fixture.slice(node.start, node.end);
	const fields: ImageFields = {
		alt: node.alt ?? '',
		url: node.url ?? '',
		...(node.title !== undefined ? { title: node.title } : {}),
		...(node.label !== undefined ? { label: node.label } : {}),
		...(node.width !== undefined ? { width: node.width } : {}),
		...(node.height !== undefined ? { height: node.height } : {}),
		...(node.crop !== undefined ? { crop: node.crop } : {})
	};
	assertIs(
		rung.rewriteImage(source, fields),
		source,
		`rewriteImage re-emits ${JSON.stringify(source)} from the fields the scan read out of it`
	);
}

// ── registration ─────────────────────────────────────────────────────────────

function checkRegistrationHygiene(
	profile: InlineConformanceProfile,
	prefix: string,
	rung: InlineRung
): string {
	const reserved = isReservedInlineTrigger(profile.trigger);
	// Two handlers may share a prefix at different priorities (emoji and directive text both
	// live on `:`), but two at the same priority could not be ordered by the dispatch.
	const sameRung = getInlineRungs(profile.trigger).filter(
		(r) => r.prefix === prefix && r.priority === rung.priority
	);
	assertIs(
		sameRung.length,
		1,
		`exactly one rung holds prefix ${JSON.stringify(prefix)} at priority ${rung.priority}`
	);

	if (reserved) {
		assert(prefix.length >= 2, 'a reserved trigger is reachable only through a multi-char prefix');
		assert(
			rung.priority < INLINE_PRIORITIES.builtin,
			`a reserved-trigger rung is priced below the built-in boundary ` +
				`(${INLINE_PRIORITIES.builtin}) so its prefix outranks the built-in case; got ${rung.priority}`
		);
	} else {
		// The scan's fast bail skips an unreserved trigger unless a registration turns its
		// per-character check on; without that the recognizer never runs in prose.
		assert(
			isScanProbeTrigger(profile.trigger),
			`the scan's fast bail visits ${JSON.stringify(profile.trigger)} — a trigger it skips ` +
				`makes the recognizer unreachable in plain text`
		);
	}
	return reserved
		? `prefix rung at priority ${rung.priority}, below the built-in boundary`
		: `bare rung at priority ${rung.priority} on a scan-probed trigger`;
}

// ── Falsifiable excuses ──────────────────────────────────────────────────────

/**
 * Where the kit can check an excuse, it does: a reason is a claim about the handler, not a
 * waiver, so a profile that excuses a cell with something to test fails.
 */
function falsifyExcuse(
	cell: InlineConformanceCell,
	profile: InlineConformanceProfile,
	rung: InlineRung
): void {
	if (cell === 'overlapDecline' && (profile.overlapFixtures?.length ?? 0) > 0) {
		fail(
			'the profile supplies overlapFixtures but declares overlapDecline excused — the fixtures ' +
				'say the overlap exists, so assert the cell'
		);
	}
	if (cell === 'widget' && profile.kind !== undefined) {
		const claimed = profile.fixtures
			.flatMap((f) => mintedNodes(f, profile, rung).map((n) => ({ f, n })))
			.find(({ f, n }) => n.kind === profile.kind && isInlineWidget(n, f, defaultGrammarView));
		if (claimed) {
			fail(
				`"${profile.kind}" IS a registered live widget (from ${JSON.stringify(claimed.f)}), so ` +
					`the widget cell has something to bite on and cannot be excused`
			);
		}
	}
	if (cell === 'editingPolicy' && profile.kind !== undefined) {
		const policy = getInlineWidgetEditing(profile.kind, defaultGrammarView);
		if (policy && Object.keys(policy).length > 0) {
			fail(
				`"${profile.kind}" declares an editing policy, so the editingPolicy cell cannot be excused`
			);
		}
	}
	if (cell === 'imageClaim') {
		const stamped = profile.fixtures
			.flatMap((f) => mintedNodes(f, profile, rung))
			.find((n) => n.syntaxClaim?.prefix === rung.prefix);
		if (stamped) {
			fail(
				`a fixture mints a stamped built-in "${stamped.kind}", so the imageClaim cell has ` +
					`something to bite on and cannot be excused`
			);
		}
	}
}
