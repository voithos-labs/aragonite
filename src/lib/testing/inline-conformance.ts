/**
 * The inline-rung conformance kit, published at `aragonite/testing` — the
 * behavioral battery a registered inline rung is held to, the sibling of the
 * block layer's `runKindConformance` and the container kit.
 *
 * Register your rung, then point the kit at its trigger and prefix. The kit reads
 * the LIVE registry, so it composes with `resetPluginPlatformForTests()` cycles:
 * a fresh install per case is re-read per call, never cached at module scope.
 *
 * The cells:
 *   claims         — every fixture the profile supplies is actually CLAIMED by
 *                    this rung. Executed always, and first: a fixture the rung
 *                    does not claim makes every cell below it vacuous, so it
 *                    fails enrollment rather than skipping.
 *   roundTrip      — the fixtures and the kit's own adversarial interleavings of
 *                    them (adjacent, doubled, wrapped in emphasis / a code span /
 *                    a link label / a blockquote, trigger-adjacent) round-trip
 *                    byte-for-byte.
 *   overlapDecline — where the rung's prefix also opens a construct the built-in
 *                    scanner owns, the rung declines the overlap. A prefix rung is
 *                    consulted before the built-in case, so a claim it should have
 *                    refused silently rewrites the document's meaning while the
 *                    bytes round-trip perfectly.
 *   widget         — the claimed bytes are ONE atomic unit: self-delimiting, and
 *                    (for a kind that builds its own island) carrying its source
 *                    span on `data-source-*` so nothing it renders leaks into the
 *                    caret arithmetic.
 *   editingPolicy  — the widget kind's declared editing policy is in the caret-edge
 *                    dispatch's vocabulary, and an atomic whole-delete leaves bytes
 *                    that still round-trip.
 *   imageClaim     — a rung minting a BUILT-IN kind over its own bytes carries the
 *                    `rewriteImage` hook the write paths need, and the hook can
 *                    reproduce its own input.
 *   registration   — the rung is registered where the profile says it is, exactly
 *                    once, priced inside its tier, on a trigger the scan reaches.
 *
 * Required, not optional. Four cells are declared per profile (`ConformanceCoverage`)
 * because only the author knows whether the invariant has anything to bite on; the
 * DECLARATION is required, following the container kit's `terminatorCollision`
 * precedent, because every one of them is invisible to byte round-trip and an
 * optional cell is left undeclared by exactly the rungs that need it. `fixtures` is
 * required and non-empty for the same reason a partition pin must not skip.
 *
 * An exemption the kit can falsify, it falsifies: declaring `imageClaim` exempt
 * while a fixture mints a stamped built-in fails, and a reserved-trigger rung may
 * not excuse `overlapDecline` at all.
 *
 * Failures throw a plain `Error` — no test runner is imported, so the kit runs
 * unchanged under Vitest, Jest or `node:test`.
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

// ── Profile ──────────────────────────────────────────────────────────────────

export interface InlineConformanceProfile {
	/** The single character the rung registered on. */
	trigger: string;
	/** The rung's multi-char prefix; omit for a bare-trigger registration. */
	prefix?: string;
	/** Disambiguator when two rungs share a prefix on one trigger at different rungs. */
	priority?: number;
	/**
	 * The inline kind the rung mints as its own. Omit for a rung that only mints
	 * built-in kinds over its own bytes (the `![[…]]`-as-`image` shape).
	 */
	kind?: AnyInlineKind;
	/**
	 * Single-line sources the rung CLAIMS. Required and non-empty: every other cell
	 * reads the node a fixture produces, so a rung with no claimed fixture would be
	 * enrolled without being tested.
	 */
	fixtures: string[];
	/**
	 * Single-line sources whose bytes the rung's prefix matches but a built-in (or an
	 * earlier rung) owns. Required when `overlapDecline` asserts.
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
 * What a cell's check reports back: a detail line for an executed cell, or an
 * explicit status for a cell whose mechanism was out of headless reach. A check
 * that skipped its work must say `boundary` — reporting `asserted` over a path
 * where nothing ran is the silent skip the whole vocabulary exists to refuse.
 */
type CellOutcome = string | { status: 'asserted' | 'boundary'; detail: string };

/**
 * Run every conformance cell for the registered rung the profile names. Resolves
 * with the coverage report when the asserted cells hold and the excused cells carry
 * a reason the kit cannot falsify; throws an `Error` naming every failed cell.
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

// ── Profile validation + rung lookup ─────────────────────────────────────────

function validateProfile(profile: InlineConformanceProfile, prefix: string): void {
	assertIs(profile.trigger.length, 1, 'trigger is a single character');
	assert(
		prefix.startsWith(profile.trigger),
		`prefix ${JSON.stringify(prefix)} begins with the trigger ${JSON.stringify(profile.trigger)}`
	);
	assert(profile.fixtures.length > 0, 'the profile supplies at least one fixture the rung claims');
	for (const fixture of profile.fixtures) assertSingleLine(fixture, 'fixture');

	// A prefix rung is consulted BEFORE the built-in case it shadows, so an overlap
	// always exists for it and there is nothing to excuse — the exemption vocabulary
	// would only hide the one failure this cell was built for.
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
 * Every node this rung minted from `source`, in document order. A rung's own kind
 * carries no stamp by design (the editor has no grammar for it, so no write path
 * could read one), so ownership reads two ways: the declared kind, or the claim the
 * scan stamps on a BUILT-IN kind minted over the rung's bytes.
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
 * (`see [^a] and [^b]`), and every cell below walks all of them — a check that read
 * only the first would leave the rest of an author's own fixture unexercised.
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
 * Block contexts the kit drops each fixture into. The profile supplies the source,
 * the kit drives the oracle — these are the adjacencies a rung's `end` arithmetic
 * gets wrong: another construct starting where the claim ended, the rung's own
 * trigger touching its edges, and a wrapper whose own grammar contests the bytes.
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

const TAIL_FILLERS = ['z', 'q', 'k'];

/**
 * Inert bytes past the scan range. Catches the rung that grabs to end-of-string:
 * carrying none of the author's grammar, it can only be reached by a claim that
 * stops at no terminator at all.
 */
function inertTail(trigger: string): string {
	return TAIL_FILLERS.find((c) => c !== trigger)!.repeat(4);
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

			// A block whose scan range stops short of its raw — a heading's content range
			// excludes a closing `#` run, a table cell's excludes its `|`. Bytes past
			// `end` are invisible to a range-correct rung whatever they spell, since
			// declining a claim that would exceed `end` IS the contract, so none of these
			// can red one. Three drives, because the ways to overrun differ:
			//
			//   inert tail        — a claim that stops at no terminator at all;
			//   the fixture       — the author's own grammar past the boundary, which is
			//                       what a terminator search reaches for;
			//   opener straddling — the range cut just past a prefix whose closer lies
			//                       beyond it. Deterministic where the plain fixture tail
			//                       is not: whether that one presents an unterminated
			//                       opener at the boundary depends on the author's fixtures.
			assertScanTiles(source + inertTail(profile.trigger), source.length);
			assertScanTiles(source + fixture, source.length);
			assertScanTiles(
				source + fixture,
				source.length + Math.min(rung.prefix.length, fixture.length)
			);
			count++;
		}
	}
	return `${count} source(s) round-trip byte-for-byte and tile their scan range`;
}

/**
 * The inline layer's own byte round-trip. `serialize(parse(s))` is raw-driven and
 * cannot see an inline rung at all, so the property that IS a rung's to break is the
 * scanner's contract: the nodes tile `[0, end)` with no gap and no overlap, and
 * concatenating their slices reproduces the scanned bytes. A rung whose claim runs
 * past `end`, or stops short of what it consumed, breaks the caret arithmetic of
 * every offset after it while the document round-trips perfectly.
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
		assert(
			node.end <= end,
			`the "${node.kind}" claim in ${JSON.stringify(raw)} stops at the scan range end (${end}), ` +
				`not at ${node.end} — it is reading bytes the block did not offer`
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
 * At every position the scan would consult this rung — its prefix matching at the
 * cursor, the gate `tryRungs` applies — the recognizer must return null. A decline
 * leaves the scan context untouched, so declining everywhere IS the guarantee that
 * the built-in reads byte-identical bytes; the parse-side half then confirms the
 * document holds nothing this rung claimed.
 */
function checkOverlapDecline(profile: InlineConformanceProfile, rung: InlineRung): string {
	const fixtures = profile.overlapFixtures ?? [];
	let consulted = 0;
	for (const source of fixtures) {
		let positions = 0;
		for (let pos = 0; pos < source.length; pos++) {
			if (!source.startsWith(rung.prefix, pos)) continue;
			positions++;
			const claimed = rung.recognizer(source, pos, source.length);
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
				isInlineWidget(node, fixture),
				`the "${kind}" node from ${JSON.stringify(fixture)} is a registered live widget`
			);
			assertSelfDelimiting(fixture, node, kind);
		}
	}

	// Both early exits report BOUNDARY, not asserted: the island contract genuinely
	// did not run, and a cell that says it passed over work it skipped is the silent
	// skip this vocabulary exists to refuse.
	if (getInlineWidgetComponent(kind) !== undefined) {
		return {
			status: 'boundary',
			detail:
				`${RECOGNITION_HALF} executed; the island wrapper of a \`component\` kind is minted by ` +
				`the render layer, not by the plugin, so it is not the plugin’s to get wrong`
		};
	}
	if (typeof document === 'undefined') {
		return { status: 'boundary', detail: `${RECOGNITION_HALF} executed — ${NO_DOM}` };
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
 * The claimed bytes must stand alone. `data-source-*` hands exactly this slice to
 * the clipboard and to a source reveal, so a slice that only forms in the context it
 * was cut from pastes back as broken prose and folds back as lost markup — while the
 * document it came from round-trips perfectly.
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
	const island = buildCoreInlineWidget(node, fixture);
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
 * The offset walk counts a widget as its SOURCE span, never as what it renders — an
 * emoji island showing one glyph for seven raw bytes still walks seven. Rendering the
 * whole fixture and measuring the walk is the oracle for that: it fires for a missing
 * or wrong `data-source-*`, and for widget text that leaks into the arithmetic. Every
 * caret offset in the block rides on it, and no byte moves when it is wrong.
 */
function assertWalkLengthIsRawLength(fixture: string): void {
	const container = document.createElement('div');
	container.appendChild(renderInlineNodes(parseInline(fixture, 0, fixture.length), fixture));
	assertIs(
		Number(containerDomTextLength(container)),
		fixture.length,
		`the offset walk over the rendered ${JSON.stringify(fixture)} measures its raw length`
	);
}

// ── editingPolicy ────────────────────────────────────────────────────────────

const DELETE_GRANULARITIES = ['atomic', 'select-then-delete'];
const ON_EDGE_VALUES = ['select', 'step-over'];

/**
 * A policy field outside the caret-edge dispatch's vocabulary is read as absent and
 * the kind silently takes the default — the widget behaves like an image while its
 * registration says otherwise, and no byte differs.
 */
function checkEditingPolicy(profile: InlineConformanceProfile, rung: InlineRung): string {
	const kind = profile.kind;
	assert(kind !== undefined, 'the editingPolicy cell asserts but the profile names no kind');
	const policy = getInlineWidgetEditing(kind);
	assert(
		policy !== undefined,
		`"${kind}" declares no editing policy — register one, or declare this cell exempt if the ` +
			`widget takes the default select-then-delete behavior deliberately`
	);
	assertPolicyVocabulary(policy, kind);

	if (policy.deleteGranularity === 'atomic') {
		for (const fixture of profile.fixtures) {
			// One press deletes ONE widget, so each claim is excised on its own — a
			// fixture carrying two produces two independent post-delete documents.
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
			ON_EDGE_VALUES.includes(policy.onEdge),
			`"${kind}" onEdge is one of ${ON_EDGE_VALUES.join(' | ')}`
		);
	}
	if (policy.onSelectedKey !== undefined) {
		assertIs(typeof policy.onSelectedKey, 'function', `"${kind}" onSelectedKey is callable`);
	}
}

// ── imageClaim ───────────────────────────────────────────────────────────────

/**
 * A rung minting a BUILT-IN kind borrows the editor's model for bytes of its own, and
 * the editor's inverse for that kind emits the built-in grammar — so without the
 * `rewriteImage` hook a resize turns `![[cat.png|300]]` into GFM and takes the
 * author's syntax with it. The document round-trips throughout; it is simply a
 * different document. The kit mirrors what the scan stamps: built-in kinds only, the
 * rung's own kind unstamped by design.
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
 * The hook must be able to re-emit the node it was handed, unedited. A hook that
 * cannot reproduce its own input cannot be trusted with an edited one — and because a
 * result byte-identical to the source is dropped by the commit's equality guard with
 * no warning, the failure would surface as an edit that silently does nothing.
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
		...(node.height !== undefined ? { height: node.height } : {})
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
	// Two rungs MAY share a prefix on one trigger at different priorities — that is
	// how emoji and the directive text tier coexist on `:`. What may never happen is
	// two at the same rung, which register-once forbids and dispatch could not order.
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
		// The fast bail skips an unreserved trigger unless a registration turns its
		// per-character probe on; without it the recognizer is a silent no-op in prose.
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
 * An excuse the kit can check, it checks. A reason is a claim about the rung, not a
 * waiver: a profile that declares `widget` exempt while the kind IS a registered
 * widget, or `imageClaim` exempt while a fixture mints a stamped built-in, has
 * described a rung it does not have.
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
			.find(({ f, n }) => n.kind === profile.kind && isInlineWidget(n, f));
		if (claimed) {
			fail(
				`"${profile.kind}" IS a registered live widget (from ${JSON.stringify(claimed.f)}), so ` +
					`the widget cell has something to bite on and cannot be excused`
			);
		}
	}
	if (cell === 'editingPolicy' && profile.kind !== undefined) {
		const policy = getInlineWidgetEditing(profile.kind);
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
