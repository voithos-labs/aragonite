/**
 * G4.23 — requirement↔spec lockstep. `docs/contributing/testing.md` makes the filesystem the
 * authoritative list of e2e coverage: every spec pairs with a requirement file and vice
 * versa. Three rules, descending: PAIRING (hard, both directions plus stem collision), SHAPE
 * (hard, catches the placeholder written to satisfy pairing), SCENARIO INFLATION (allowlisted
 * ratio; equality was measured and refuted, so divergence is legal and unexplained divergence
 * is not). Bullets are semantic paraphrases: a green run proves pairing, never
 * scenario-to-test mapping. Lives outside `test:editor:invariants`; verify via `src/lib/e2e/lint/`.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SPEC_DIR = path.resolve('src/lib/e2e/tests');
const REQUIREMENT_DIR = path.resolve('src/lib/e2e/requirements');

// ── Rule 3's named divergences ──────────────────────────────────────────────

interface InflationException {
	/** Spec path relative to `tests/`, or a directory prefix ending in `/`. */
	spec: string;
	reason: string;
}

/** Fails closed and only shrinks: a stale entry is reported, so the list cannot outlive
 *  the shape that justified it. */
const INFLATION_ALLOWLIST: readonly InflationException[] = [
	{
		spec: 'simulation/',
		reason:
			'seeded gesture family: one seeded session drives every gesture, so the requirement enumerates gesture coverage and oracle checkpoints, not tests'
	},
	{
		spec: 'plugins/details-terminator-paste.spec.ts',
		reason:
			'four of six scenarios are pinned at the unit sink (terminator-collision-paste.test.ts); e2e carries the two browser-visible rows'
	},
	{
		spec: 'selection/gap-caret-arrival-scopes.spec.ts',
		reason:
			'three of the six bullets are v1 narrowings — the click route, container entry, and the measured-unreachable windowed seam — and a fourth is the interaction note, none of them scenarios the two gestures could drive'
	},
	{
		spec: 'blocks/atomic-cross-block-delete.spec.ts',
		reason:
			'four hard-invariant bullets asserted in EVERY scenario, and the two tests are one parametrized loop over the atomic variants'
	},
	{
		spec: 'blocks/code/fence-content-validity.spec.ts',
		reason:
			'the write rule reaches most of its doors headlessly (the byte sinks, find/replace, the range-delete arms), so those bullets are unit-pinned and the spec drives only the gestures a user makes through the DOM'
	},
	{
		spec: 'perf/perf-gate.perf.spec.ts',
		reason:
			'two parametrized loops run 13 gated rows, and the bullets state budget, baseline policy and what the gate cannot see rather than scenarios'
	},
	{
		spec: 'perf/typing-latency.perf.spec.ts',
		reason:
			'five test calls, three of them parametrized loops, run ~35 report rows, and the bullets state measurement semantics (caret target, settle predicate, sizes, artifacts, the rung rows and their confound) rather than scenarios'
	},
	{
		spec: 'perf/vr-reveal-anchor.spec.ts',
		reason:
			'the edge-case bullets are properties the two race cases carry jointly, including one explicitly not-covered case'
	},
	{
		spec: 'plugins/conformance-sweep.spec.ts',
		reason:
			'four column tests sweep every enrolled kind; the bullets state per-column semantics, enrolment properties and the miss-analysis, not one-test scenarios'
	},
	{
		spec: 'plugins/callout-container.spec.ts',
		reason: 'compound test: "type, split, merge, and undo" walks six bullets in one session'
	},
	{
		spec: 'plugins/details-nested-windowing.spec.ts',
		reason: 'compound test: the closed→open→closed toggle sequence must run in one mount'
	},
	{
		spec: 'plugins/details-reveal.spec.ts',
		reason: 'compound test: search-in, caret check, and Escape are one reveal round-trip'
	},
	{
		spec: 'plugins/mermaid-theme.spec.ts',
		reason: 'compound test: the dark→light→dark flip must observe memoized re-renders in sequence'
	},
	{
		spec: 'presentation/presentation-showcase.spec.ts',
		reason: 'compound test: the mode toggle round-trip is one session over one mounted document'
	},
	{
		spec: 'source-prop.spec.ts',
		reason:
			'three of six bullets name coverage owned elsewhere (init behavior, decorations/source-swap-epoch, search/source-swap-rescan)'
	}
];

// ── Source model ────────────────────────────────────────────────────────────

/** The requirement stem a spec pairs with: `.perf` is a project selector, not a subject. */
export function requirementStem(specPath: string): string {
	return specPath.replace(/\.perf\.spec\.ts$/, '').replace(/\.spec\.ts$/, '');
}

export interface RequirementShape {
	hasTitle: boolean;
	sections: number;
	/** Top-level bullets plus `###` subsections — the two forms a scenario takes. */
	scenarioUnits: number;
}

/**
 * One `-` at COLUMN 0 is one scenario: continuation lines are indented and nested bullets are
 * detail of their parent. Ordered items are prose, not scenarios.
 */
export function readRequirementShape(text: string): RequirementShape {
	let hasTitle = false;
	let sections = 0;
	let scenarioUnits = 0;
	let inFence = false;
	for (const line of text.split('\n')) {
		if (/^\s*```/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (/^#\s+\S/.test(line)) hasTitle = true;
		else if (/^##\s+(?!#)\S/.test(line)) sections++;
		else if (/^###\s+\S/.test(line)) scenarioUnits++;
		else if (/^-\s+\S/.test(line)) scenarioUnits++;
	}
	return { hasTitle, sections, scenarioUnits };
}

/**
 * A parametrized loop counts ONCE — the shape rule 3's threshold was measured against. A
 * string-literal TITLE is what makes a call a test: `test.skip(condition, reason)` is a run
 * guard, and counting those inflated the test side exactly in the files most likely to drift.
 */
export function countTests(code: string): number {
	const withoutComments = code
		.split('\n')
		.map((line) => {
			const trimmed = line.trimStart();
			const isComment =
				trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
			return isComment ? '' : line;
		})
		.join('\n');
	const calls = withoutComments.matchAll(
		/(?:^|[\s.;{}])test(?:\.skip|\.fixme|\.only)?\s*\(\s*(.?)/g
	);
	return [...calls].filter(({ 1: firstArgument }) => `'"\``.includes(firstArgument)).length;
}

/** Rule 3's predicate: a requirement list that ran far ahead of its spec. */
export function isInflated(scenarioUnits: number, tests: number): boolean {
	return scenarioUnits >= 3 * Math.max(tests, 1) && scenarioUnits - tests >= 4;
}

function relativePaths(root: string, suffix: string): string[] {
	const found: string[] = [];
	function walk(dir: string, prefix: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
			else if (entry.name.endsWith(suffix)) found.push(prefix + entry.name);
		}
	}
	walk(root, '');
	return found.sort();
}

interface Pair {
	spec: string;
	requirement: string;
	shape: RequirementShape;
	tests: number;
}

interface Lockstep {
	specs: string[];
	requirements: string[];
	pairs: Pair[];
	specsWithoutRequirement: string[];
	requirementsWithoutSpec: string[];
	stemCollisions: string[];
}

function scanLockstep(): Lockstep {
	const specs = relativePaths(SPEC_DIR, '.spec.ts');
	const requirements = relativePaths(REQUIREMENT_DIR, '.md');
	const requirementStems = new Set(requirements.map((file) => file.replace(/\.md$/, '')));

	const claimedBy = new Map<string, string[]>();
	for (const spec of specs) {
		const stem = requirementStem(spec);
		claimedBy.set(stem, [...(claimedBy.get(stem) ?? []), spec]);
	}

	const pairs: Pair[] = [];
	const specsWithoutRequirement: string[] = [];
	for (const spec of specs) {
		const stem = requirementStem(spec);
		if (!requirementStems.has(stem)) {
			specsWithoutRequirement.push(spec);
			continue;
		}
		pairs.push({
			spec,
			requirement: `${stem}.md`,
			shape: readRequirementShape(readFileSync(path.join(REQUIREMENT_DIR, `${stem}.md`), 'utf8')),
			tests: countTests(readFileSync(path.join(SPEC_DIR, spec), 'utf8'))
		});
	}

	return {
		specs,
		requirements,
		pairs,
		specsWithoutRequirement,
		requirementsWithoutSpec: requirements.filter(
			(file) => !claimedBy.has(file.replace(/\.md$/, ''))
		),
		stemCollisions: [...claimedBy]
			.filter(([, claimants]) => claimants.length > 1)
			.map(([stem, claimants]) => `${stem}.md ← ${claimants.join(' + ')}`)
	};
}

/** Whether an entry covers a spec: a trailing `/` makes it a directory prefix. */
export function coversSpec(entry: InflationException, spec: string): boolean {
	return entry.spec.endsWith('/') ? spec.startsWith(entry.spec) : spec === entry.spec;
}

function allowedInflation(spec: string): boolean {
	return INFLATION_ALLOWLIST.some((entry) => coversSpec(entry, spec));
}

export interface AllowlistAudit {
	/** Names a spec the tree does not have — a typo, or a spec since deleted. */
	dangling: string[];
	/** Every spec it covers is covered by another entry, so it can never be read. */
	shadowed: string[];
	/** Covers live specs, none of which diverges any more. */
	stale: string[];
}

/**
 * Each entry is audited INDEPENDENTLY: a first-match lookup conflates three failures, since a
 * file entry under a directory entry never wins it and reads as "no longer diverges" while
 * diverging. Shadowing is broken by POSITION, not set inclusion alone — mutually-subsuming
 * entries would name no entry to delete; reporting the later one leaves the earlier covering
 * every spec it named.
 */
export function auditAllowlist(
	entries: readonly InflationException[],
	specs: readonly string[],
	inflatedSpecs: readonly string[]
): AllowlistAudit {
	const covered = entries.map((entry) => specs.filter((spec) => coversSpec(entry, spec)));
	const audit: AllowlistAudit = { dangling: [], shadowed: [], stale: [] };
	entries.forEach((entry, index) => {
		const mine = covered[index];
		if (mine.length === 0) audit.dangling.push(entry.spec);
		else if (
			entries.some((earlier, j) => j < index && mine.every((spec) => coversSpec(earlier, spec)))
		)
			audit.shadowed.push(entry.spec);
		else if (!mine.some((spec) => inflatedSpecs.includes(spec))) audit.stale.push(entry.spec);
	});
	return audit;
}

// ── The gate ────────────────────────────────────────────────────────────────

describe('G4.23 requirement↔spec lockstep', () => {
	const lockstep = scanLockstep();

	// Non-vacuity: the rules prove something only if the walk found the tree.
	it('resolved the spec and requirement trees', () => {
		expect(lockstep.specs.length).toBeGreaterThan(300);
		expect(lockstep.pairs.length).toBeGreaterThan(300);
	});

	it('every spec has a requirement file', () => {
		expect(
			lockstep.specsWithoutRequirement,
			`specs with no requirement file (write the scenario list, or the spec's coverage is claimed by nothing):\n  ${lockstep.specsWithoutRequirement.join('\n  ')}`
		).toEqual([]);
	});

	it('every requirement file has a spec', () => {
		expect(
			lockstep.requirementsWithoutSpec,
			`requirement files with no spec (the scenarios are documented but unenforced):\n  ${lockstep.requirementsWithoutSpec.join('\n  ')}`
		).toEqual([]);
	});

	it('no two specs claim one requirement file', () => {
		expect(
			lockstep.stemCollisions,
			`requirement stems claimed twice — the .perf strip makes these collide, so one spec's scenarios hide behind the other's file:\n  ${lockstep.stemCollisions.join('\n  ')}`
		).toEqual([]);
	});

	it('every requirement file carries a title, a section, and a scenario', () => {
		const malformed = lockstep.pairs
			.filter(({ shape }) => !shape.hasTitle || shape.sections === 0 || shape.scenarioUnits === 0)
			.map(
				({ requirement, shape }) =>
					`${requirement} (title: ${shape.hasTitle}, sections: ${shape.sections}, scenarios: ${shape.scenarioUnits})`
			);
		expect(
			malformed,
			`requirement files that satisfy the pairing rule without listing anything:\n  ${malformed.join('\n  ')}`
		).toEqual([]);
	});

	it('every spec declares at least one test', () => {
		const empty = lockstep.pairs.filter(({ tests }) => tests === 0).map(({ spec }) => spec);
		expect(
			empty,
			`specs with no test() call — their requirement file's scenarios run nowhere:\n  ${empty.join('\n  ')}`
		).toEqual([]);
	});

	it('every requirement list that ran ahead of its spec is named with a reason', () => {
		const unexplained = lockstep.pairs
			.filter(
				({ spec, shape, tests }) =>
					isInflated(shape.scenarioUnits, tests) && !allowedInflation(spec)
			)
			.map(
				({ spec, shape, tests }) => `${spec} (${shape.scenarioUnits} scenarios, ${tests} tests)`
			);
		expect(
			unexplained,
			`requirement lists 3× longer than their spec's test count. Either the scenarios lost their tests, or the divergence is deliberate — in which case name it in INFLATION_ALLOWLIST with the reason:\n  ${unexplained.join('\n  ')}`
		).toEqual([]);
	});

	const audit = auditAllowlist(
		INFLATION_ALLOWLIST,
		lockstep.pairs.map(({ spec }) => spec),
		lockstep.pairs
			.filter(({ shape, tests }) => isInflated(shape.scenarioUnits, tests))
			.map(({ spec }) => spec)
	);

	it('no allowlist entry outlived the divergence it explains', () => {
		expect(
			audit.stale,
			`allowlist entries whose spec no longer diverges (delete them — the list only shrinks):\n  ${audit.stale.join('\n  ')}`
		).toEqual([]);
	});

	it('every allowlist entry names a live spec no other entry already covers', () => {
		expect(
			audit.dangling,
			`allowlist entries naming a spec that does not exist (renamed or deleted):\n  ${audit.dangling.join('\n  ')}`
		).toEqual([]);
		expect(
			audit.shadowed,
			`allowlist entries a broader entry already covers, so their reason is never read:\n  ${audit.shadowed.join('\n  ')}`
		).toEqual([]);
	});
});

describe('G4.23 requirement↔spec lockstep — classifier self-tests', () => {
	it('strips the .perf project selector but keeps the subject stem', () => {
		expect(requirementStem('perf/attribution.perf.spec.ts')).toBe('perf/attribution');
		expect(requirementStem('perf/vr-windowing.spec.ts')).toBe('perf/vr-windowing');
		expect(requirementStem('smoke.spec.ts')).toBe('smoke');
	});

	it('counts top-level bullets and ### subsections, not their detail', () => {
		const text = [
			'# Feature: x',
			'',
			'## Happy paths',
			'',
			'- first scenario',
			'  spanning two lines',
			'  - a nested detail, not a scenario',
			'- second scenario',
			'',
			'## Scenarios',
			'',
			'### 1. a numbered scenario',
			'',
			'prose',
			''
		].join('\n');
		expect(readRequirementShape(text)).toEqual({ hasTitle: true, sections: 2, scenarioUnits: 3 });
	});

	it('ignores bullets inside fenced code', () => {
		const text = '# Feature: x\n\n## Happy paths\n\n- real\n\n```\n- fenced\n- fenced\n```\n';
		expect(readRequirementShape(text).scenarioUnits).toBe(1);
	});

	it('counts test() calls outside comments, including modifiers', () => {
		const code = [
			"test('a', () => {});",
			"test.skip('b', () => {});",
			"// test('commented out', () => {});",
			"	test.fixme('c', () => {});",
			"expect(latest('d')).toBe(1);",
			'test(`a ${shape} template title`, () => {});'
		].join('\n');
		expect(countTests(code)).toBe(4);
	});

	// The discriminating case: a run guard and a skipped test are both `test.skip(`,
	// and only the second has a title.
	it('does not count a file-level test.skip run guard as a test', () => {
		expect(
			countTests("test.skip(!process.env.PERF || !!process.env.PERF_GATE, 'report-only');")
		).toBe(0);
		expect(
			countTests("test.skip(condition, 'reason');\ntest.skip('a real skipped test', fn);")
		).toBe(1);
	});

	it('fires on a requirement list that ran ahead, not on ordinary divergence', () => {
		expect(isInflated(6, 6)).toBe(false);
		// The common shape: one test walks two or three bullets.
		expect(isInflated(9, 5)).toBe(false);
		expect(isInflated(18, 1)).toBe(true);
		// Ratio without volume stays quiet: the delta floor holds a one-test spec's
		// scenario list to four before it reads as drift.
		expect(isInflated(4, 1)).toBe(false);
		expect(isInflated(5, 1)).toBe(true);
	});

	it('tells a shadowed allowlist entry from a stale one', () => {
		const entries = [
			{ spec: 'simulation/', reason: 'family' },
			{ spec: 'simulation/emoji-ops.spec.ts', reason: 'shadowed by the family entry' },
			{ spec: 'plugins/healed.spec.ts', reason: 'no longer diverges' },
			{ spec: 'plugins/gone.spec.ts', reason: 'names a spec that is not there' }
		];
		const specs = [
			'simulation/emoji-ops.spec.ts',
			'plugins/healed.spec.ts',
			'plugins/still-diverging.spec.ts'
		];
		expect(auditAllowlist(entries, specs, ['simulation/emoji-ops.spec.ts'])).toEqual({
			dangling: ['plugins/gone.spec.ts'],
			shadowed: ['simulation/emoji-ops.spec.ts'],
			stale: ['plugins/healed.spec.ts']
		});
	});

	it('keeps a directory entry live while any spec under it diverges', () => {
		const entries = [{ spec: 'simulation/', reason: 'family' }];
		const specs = ['simulation/a.spec.ts', 'simulation/b.spec.ts'];
		expect(auditAllowlist(entries, specs, ['simulation/b.spec.ts']).stale).toEqual([]);
		expect(auditAllowlist(entries, specs, []).stale).toEqual(['simulation/']);
	});
});
