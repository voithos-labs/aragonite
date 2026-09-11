/**
 * G4.63 — bundled-plugin test boundary: a file under a per-plugin test directory reaches
 * into aragonite only where a third-party author can. The published entry points (`$lib`,
 * `$lib/plugin`, `$lib/testing`), the plugin's own source, another plugin's PUBLISHED
 * subpath, the copyable in-repo test support, relative paths outside library code. An npm
 * package is the author's own business. G4.16's twin one layer out: that one proves the
 * barrels can BUILD a plugin, this one that they can TEST it. An allowlist entry is a
 * missing public door, named.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { collectEditorSources } from './scan-source';

const PLUGIN_SRC_ROOT = 'src/lib/plugins';
const PLUGIN_TEST_ROOT = 'src/lib/test/plugins';

interface Exemption {
	/** The exact specifiers this file may still reach for. */
	specifiers: string[];
	/** The public door that does not exist yet, which is why the reach-in stands. */
	reason: string;
}

/**
 * Eight doors are missing, and every entry below names the one it waits on: a headless
 * editor-actions environment, tree mutation off a parsed document, the opaque-raw
 * predicates, parse convergence, registry read-back, the perf instruments, the built-in
 * text surface, and an inline node's raw text. Closing one empties its entries.
 */
const ALLOWLIST: Record<string, Exemption> = {
	'src/lib/test/plugins/admonitions/blockquote-indent-cap.test.ts': {
		specifiers: ['$lib/schema/block-kind-descriptor'],
		reason: 'no registry read-back: a kind can be registered and probed, never read back'
	},
	'src/lib/test/plugins/admonitions/fence-escalation.test.ts': {
		specifiers: ['$lib/schema/block-kind-descriptor', '$lib/invariants/node-shape'],
		reason:
			'no registry read-back, and the opaque stale-raw / rebuild-determinism predicates are ' +
			'off the testing barrel (only checkCopyIsRawByteSlice is published)'
	},
	'src/lib/test/plugins/admonitions/formation-harness.ts': {
		specifiers: [
			'$lib/editor-actions/commit/undo-controller',
			'$lib/editor-actions/commit/history',
			'$lib/editor-actions/container-edit',
			'$lib/editor-actions/nested/nested-actions',
			'$lib/reactivity/block-list-state.svelte'
		],
		reason:
			'no headless editor-actions environment on the testing barrel: the conformance kits ' +
			'build one internally, an author outside the repo cannot'
	},
	'src/lib/test/plugins/admonitions/github-alert-empty-body.test.ts': {
		specifiers: ['$lib/tree-operations', '$lib/invariants/node-shape'],
		reason:
			'no door mutates a parsed document off an instance, and the stale-raw predicate is ' +
			'off the testing barrel'
	},
	'src/lib/test/plugins/admonitions/github-alert-formation-siblings.test.ts': {
		specifiers: [
			'$lib/editor-actions/block-edit',
			'$lib/editor-actions/commit/undo-controller',
			'$lib/testing/parse-convergence'
		],
		reason:
			'no headless editor-actions environment, and parse convergence lives in src/lib/testing ' +
			'without reaching the testing barrel'
	},
	'src/lib/test/plugins/admonitions/github-alert-typed-formation.test.ts': {
		specifiers: [
			'$lib/editor-actions/block-edit',
			'$lib/editor-actions/commit/undo-controller',
			'$lib/testing/parse-convergence',
			'$lib/tree-operations'
		],
		reason:
			'no headless editor-actions environment, no published parse convergence, and no door ' +
			'reads a node by path out of a parsed document'
	},
	'src/lib/test/plugins/admonitions/github-alert-unwrap.test.ts': {
		specifiers: ['$lib/tree-operations'],
		reason: 'no published door unwraps a child from its quote off a parsed document'
	},
	'src/lib/test/plugins/details/terminator-collision.test.ts': {
		specifiers: [
			'$lib/editor-actions/commit/undo-controller',
			'$lib/editor-actions/container-edit',
			'$lib/editor-actions/nested/nested-actions',
			'$lib/reactivity/block-list-state.svelte',
			'$lib/invariants/node-shape',
			'$lib/schema/block-kind-descriptor'
		],
		reason:
			'no headless editor-actions environment, no published opaque stale-raw predicate, and ' +
			'no registry read-back'
	},
	'src/lib/test/plugins/details/terminator-collision-paste.test.ts': {
		specifiers: [
			'$lib/editor-actions/commit/undo-controller',
			'$lib/editor-actions/paste-coordinator',
			'$lib/invariants/node-shape',
			'$lib/reactivity/state-registry',
			'$lib/tree-operations/paste-surfaces',
			'$lib/tree-operations/paste/dispatch',
			'$lib/tree-operations/paste/hooks',
			'$lib/tree-operations/paste/replace-block-at-parent'
		],
		reason:
			'the paste pipeline publishes applyPasteTransforms alone: no surface registration, no ' +
			'dispatch, and no headless environment to run either against'
	},
	'src/lib/test/plugins/details/terminator-collision-structural.test.ts': {
		specifiers: [
			'$lib/invariants/node-shape',
			'$lib/selection/range-delete',
			'$lib/tree-operations/node-ops',
			'$lib/tree-operations/sharing'
		],
		reason:
			'no published door splits or range-deletes a parsed document, and no published opaque ' +
			'stale-raw predicate to hold the result to'
	},
	'src/lib/test/plugins/emoji/coexistence.test.ts': {
		specifiers: ['$lib/core/directive/kinds'],
		reason:
			'the directive inline tier has no published kind name; the plugin barrel publishes the ' +
			'body wrap and the registration doors only'
	},
	'src/lib/test/plugins/emoji/widget.test.ts': {
		specifiers: ['$lib/core/inline/inline-widgets'],
		reason: 'no registry read-back: a widget kind registers its editing policy but never reads it'
	},
	'src/lib/test/plugins/footnotes/definition-split-separator.test.ts': {
		specifiers: ['$lib/tree-operations', '$lib/testing/parse-convergence'],
		reason: 'no published door splits a parsed document, and no published parse convergence'
	},
	'src/lib/test/plugins/footnotes/numbering-incremental.test.ts': {
		specifiers: [
			'$lib/editor-actions/block-edit',
			'$lib/editor-actions/commit/undo-controller',
			'$lib/perf/instruments',
			'$lib/schema/container-raw'
		],
		reason:
			'no headless editor-actions environment, no published ancestry rebuild, and the perf ' +
			'instruments a plugin proves its own memoization with are unpublished'
	},
	'src/lib/test/plugins/footnotes/reference-shared-walk.test.ts': {
		specifiers: ['$lib/perf/instruments', '$lib/components/blocks/text/TextEditableBlock.svelte'],
		reason:
			'the perf instruments are unpublished, and so is the built-in text surface a widget ' +
			'renders into'
	},
	'src/lib/test/plugins/footnotes/reference.test.ts': {
		specifiers: ['$lib/core/inline/inline-widgets'],
		reason: 'no registry read-back: a widget kind registers its component but never reads it'
	},
	'src/lib/test/plugins/highlight-occurrences/wiring.test.ts': {
		specifiers: ['$lib/schema/plugin-install'],
		reason:
			'no registry read-back: `onEditor` callbacks can be registered but not enumerated, so a ' +
			'per-instance wiring test cannot run one without mounting an editor'
	},
	'src/lib/test/plugins/latex/block.test.ts': {
		specifiers: ['$lib/core/inline/scan/plugin-syntax'],
		reason: 'no registry read-back: an inline rung registers on a trigger but is never listed back'
	},
	'src/lib/test/plugins/latex/inline.test.ts': {
		specifiers: ['$lib/core/inline/inline-widgets'],
		reason: 'no registry read-back for a widget kind, and no published core widget shell builder'
	},
	'src/lib/test/plugins/latex/offset-audit.test.ts': {
		specifiers: ['$lib/cursor/widget-offset'],
		reason: "no published read of an inline node's raw text out of its parent's bytes"
	},
	'src/lib/test/plugins/latex/typed-completion.test.ts': {
		specifiers: ['$lib/editor-actions/enter-completion', '$lib/schema/block-completions'],
		reason:
			'a completer registers but nothing published runs one, and the Enter seam that consults ' +
			'it has no headless entry'
	},
	'src/lib/test/plugins/mermaid/fence-escalation.test.ts': {
		specifiers: ['$lib/testing/parse-convergence'],
		reason: 'parse convergence lives in src/lib/testing without reaching the testing barrel'
	},
	'src/lib/test/plugins/toc/options.test.ts': {
		specifiers: ['$lib/schema/block-component-registry'],
		reason:
			'no registry read-back: a component entry registers its extraProps closure but nothing ' +
			'published reads it, so option threading needs a mounted editor'
	}
};

// ── The published surface ────────────────────────────────────────────────────

const PUBLIC_BARRELS = new Set(['$lib', '$lib/plugin', '$lib/testing']);

/** `$lib/...` specifiers the package's `exports` map publishes, read off package.json so a
 *  newly published plugin subpath needs no edit here. */
function publishedPluginSubpaths(): Set<string> {
	const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as {
		exports: Record<string, unknown>;
	};
	const out = new Set<string>();
	for (const key of Object.keys(pkg.exports)) {
		if (key.startsWith('./plugins/')) out.add(`$lib${key.slice(1)}`);
	}
	return out;
}

const PUBLISHED_PLUGIN_SUBPATHS = publishedPluginSubpaths();

const BUNDLED_PLUGINS = new Set(
	readdirSync(path.resolve(PLUGIN_SRC_ROOT), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
);

/** The plugin whose suite `relPath` belongs to, or null for a platform test sitting loose
 *  under the test root. */
function suiteOf(relPath: string): string | null {
	if (!relPath.startsWith(`${PLUGIN_TEST_ROOT}/`)) return null;
	const name = relPath.slice(PLUGIN_TEST_ROOT.length + 1).split('/')[0];
	return BUNDLED_PLUGINS.has(name) ? name : null;
}

function isAllowedSpecifier(relPath: string, specifier: string): boolean {
	// A relative path is fine unless it lands in library code, which would be a back door
	// around every rule below; `../../../core/parser` is the shape being closed.
	if (specifier.startsWith('.')) {
		const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), specifier));
		return !resolved.startsWith('src/lib/') || resolved.startsWith('src/lib/test/');
	}
	if (!specifier.startsWith('$lib')) return true;
	if (PUBLIC_BARRELS.has(specifier)) return true;
	if (specifier.startsWith('$lib/test/support/') || specifier.startsWith('$lib/test/harness/')) {
		return true;
	}
	if (PUBLISHED_PLUGIN_SUBPATHS.has(specifier)) return true;

	const suite = suiteOf(relPath);
	if (suite === null) return false;
	const own = `${PLUGIN_SRC_ROOT.replace('src/lib', '$lib')}/${suite}`;
	return specifier === own || specifier.startsWith(`${own}/`);
}

// ── Specifier extraction ─────────────────────────────────────────────────────

// Line-anchored so a CSS `@import` inside a <style> block can't read as a JS
// side-effect import.
const FROM_IMPORT = /^\s*(?:import|export)\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT = /^\s*import\s+['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;

function importSpecifiers(code: string): string[] {
	const specs: string[] = [];
	for (const source of [FROM_IMPORT, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT]) {
		const re = new RegExp(source.source, source.flags);
		let match: RegExpExecArray | null;
		while ((match = re.exec(code)) !== null) specs.push(match[1]);
	}
	return specs;
}

interface Reach {
	relPath: string;
	specifier: string;
}

function reachIns(sources: ReturnType<typeof collectEditorSources>): Reach[] {
	const out: Reach[] = [];
	for (const file of sources) {
		if (suiteOf(file.relPath) === null) continue;
		for (const specifier of importSpecifiers(file.code)) {
			if (!isAllowedSpecifier(file.relPath, specifier)) {
				out.push({ relPath: file.relPath, specifier });
			}
		}
	}
	return out;
}

// ── The boundary scan ────────────────────────────────────────────────────────

describe('G4.63 bundled-plugin test boundary', () => {
	const sources = collectEditorSources(path.resolve(PLUGIN_TEST_ROOT));

	it('collected the per-plugin suites', () => {
		const suites = new Set(sources.map((f) => suiteOf(f.relPath)).filter((s) => s !== null));
		expect(suites.size).toBeGreaterThan(1);
	});

	it('every reach-in past the published surface is an allowlisted missing door', () => {
		const violations = reachIns(sources).filter(
			(hit) => !ALLOWLIST[hit.relPath]?.specifiers.includes(hit.specifier)
		);
		expect(
			violations,
			`per-plugin suites reaching past the published entry points: ${violations
				.map((v) => `${v.relPath}: ${v.specifier}`)
				.join(', ')}`
		).toEqual([]);
	});

	it('every allowlisted specifier is still imported (no dead allowlist)', () => {
		const live = new Set(reachIns(sources).map((hit) => `${hit.relPath}::${hit.specifier}`));
		const dead: string[] = [];
		for (const [relPath, exemption] of Object.entries(ALLOWLIST)) {
			for (const specifier of exemption.specifiers) {
				if (!live.has(`${relPath}::${specifier}`)) dead.push(`${relPath}: ${specifier}`);
			}
		}
		expect(dead, `allowlist entries with no live import: ${dead.join(', ')}`).toEqual([]);
	});

	it('every allowlist entry names the missing door', () => {
		for (const [relPath, exemption] of Object.entries(ALLOWLIST)) {
			expect(exemption.specifiers.length, relPath).toBeGreaterThan(0);
			expect(exemption.reason.length, relPath).toBeGreaterThan(20);
		}
	});
});

// ── Classifier self-tests (non-vacuity) ──────────────────────────────────────

describe('G4.63 classifier non-vacuity', () => {
	const file = `${PLUGIN_TEST_ROOT}/details/round-trip.test.ts`;

	it('allows the three published entry points', () => {
		for (const barrel of ['$lib', '$lib/plugin', '$lib/testing']) {
			expect(isAllowedSpecifier(file, barrel)).toBe(true);
		}
	});

	it('rejects every deep $lib reach-in a rewrite is supposed to remove', () => {
		for (const deep of [
			'$lib/core/parser',
			'$lib/core/serializer',
			'$lib/core/nodes',
			'$lib/schema/registry-reset',
			'$lib/editor-actions/commit/undo-controller'
		]) {
			expect(isAllowedSpecifier(file, deep)).toBe(false);
		}
	});

	it('allows the suite its own plugin source, and another plugin only where published', () => {
		expect(isAllowedSpecifier(file, '$lib/plugins/details')).toBe(true);
		expect(isAllowedSpecifier(file, '$lib/plugins/details/details-kind')).toBe(true);
		expect(isAllowedSpecifier(file, '$lib/plugins/emoji')).toBe(true);
		expect(isAllowedSpecifier(file, '$lib/plugins/emoji/emoji-recognizer')).toBe(false);
	});

	it('allows the copyable test support and any npm package', () => {
		expect(isAllowedSpecifier(file, '$lib/test/support/round-trip')).toBe(true);
		expect(isAllowedSpecifier(file, '$lib/test/harness/editor-actions')).toBe(true);
		expect(isAllowedSpecifier(file, 'vitest')).toBe(true);
		expect(isAllowedSpecifier(file, 'fast-check')).toBe(true);
		expect(isAllowedSpecifier(file, 'svelte/store')).toBe(true);
		expect(isAllowedSpecifier(file, 'node:fs')).toBe(true);
	});

	it('allows a relative path outside library code, rejects one that reaches into it', () => {
		expect(isAllowedSpecifier(file, './fixtures')).toBe(true);
		expect(isAllowedSpecifier(file, '../../harness/scan-growth')).toBe(true);
		expect(isAllowedSpecifier(file, '../../../../../scripts/build.mjs')).toBe(true);
		expect(isAllowedSpecifier(file, '../../../core/parser')).toBe(false);
		expect(isAllowedSpecifier(file, '../../../plugins/emoji/emoji-recognizer')).toBe(false);
	});

	it('binds per-plugin suites only, leaving the loose platform tests alone', () => {
		expect(suiteOf(`${PLUGIN_TEST_ROOT}/details/round-trip.test.ts`)).toBe('details');
		expect(suiteOf(`${PLUGIN_TEST_ROOT}/kind-conformance.test.ts`)).toBe(null);
		expect(suiteOf(`${PLUGIN_TEST_ROOT}/fixtures/showcase.ts`)).toBe(null);
	});
});

describe('G4.63 specifier extraction', () => {
	it('extracts single-line, multi-line, side-effect, and dynamic specifiers', () => {
		const code = [
			"import { a } from '$lib';",
			'import {',
			'\tb,',
			'\tc',
			"} from './local';",
			"import 'katex/dist/katex.min.css';",
			"const m = await import('mermaid');"
		].join('\n');
		expect(importSpecifiers(code).sort()).toEqual(
			['$lib', './local', 'katex/dist/katex.min.css', 'mermaid'].sort()
		);
	});

	it('ignores a CSS @import in a style block', () => {
		expect(importSpecifiers("\t@import 'reset.css';")).toEqual([]);
	});
});
