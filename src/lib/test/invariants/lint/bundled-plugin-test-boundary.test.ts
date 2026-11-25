/**
 * A file under a per-plugin test directory imports from aragonite only what an outside author
 * could (G4.63): the published entry points, the plugin's own source, another plugin's published
 * subpath, the copyable in-repo test support, and relative paths outside library code. An
 * allowlist entry names the public entry point that does not exist yet.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
	aliasPath,
	bundledPluginDirs,
	collectEditorSources,
	importSpecifiers,
	isAliasSpelling,
	publishedEntrySources,
	resolveSpecifier
} from './scan-source';
import { SOURCE_DIR } from './source-paths';

const PLUGIN_TEST_ROOT = SOURCE_DIR.pluginTests;

interface Exemption {
	/** The exact specifiers this file may still reach for. */
	specifiers: string[];
	/** The public entry point that does not exist yet, which is why the reach-in stands. */
	reason: string;
}

/** Publishing the entry point an entry waits on empties that entry, and a dead one fails below. */
const ALLOWLIST: Record<string, Exemption> = {
	'src/lib/test/plugins/admonitions/blockquote-indent-cap.test.ts': {
		specifiers: ['#lib/schema/container-writer.js', '#lib/schema/editor-grammar.js'],
		reason: 'nothing published writes a container from its line shape outside a commit'
	},
	'src/lib/test/plugins/admonitions/github-alert-round-trip.test.ts': {
		specifiers: ['#lib/schema/container-writer.js', '#lib/schema/editor-grammar.js'],
		reason: 'nothing published writes a container from its line shape outside a commit'
	},
	'src/lib/test/plugins/footnotes/definition-container.test.ts': {
		specifiers: ['#lib/schema/container-writer.js'],
		reason: 'nothing published writes a container from its line shape outside a commit'
	},
	'src/lib/test/plugins/admonitions/fence-escalation.test.ts': {
		specifiers: [
			'#lib/invariants/node-shape.js',
			'#lib/tree-operations/sharing.js',
			'#lib/tree-operations/chain-rebuild.js',
			'#lib/schema/editor-grammar.js',
			'#lib/schema/container-writer.js'
		],
		reason:
			'the opaque stale-raw / rebuild-determinism predicates are off the testing barrel, and ' +
			'nothing published runs the ancestor rebuild a commit runs over a parsed document or writes ' +
			'a container alone'
	},
	'src/lib/test/plugins/admonitions/formation-harness.ts': {
		specifiers: [
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/editor-actions/commit/history.js',
			'#lib/editor-actions/container-edit.js',
			'#lib/editor-actions/nested/nested-actions.js',
			'#lib/block-lists/block-list-state.svelte.js'
		],
		reason:
			'no headless editor-actions environment on the testing barrel: the conformance kits ' +
			'build one internally, an author outside the repo cannot'
	},
	'src/lib/test/plugins/admonitions/github-alert-empty-body.test.ts': {
		specifiers: [
			'#lib/tree-operations/content-write.js',
			'#lib/tree-operations/sharing.js',
			'#lib/invariants/node-shape.js'
		],
		reason:
			'nothing published mutates a parsed document off an instance (nor makes the sharing state ' +
			'that write takes), and the stale-raw predicate is off the testing barrel'
	},
	'src/lib/test/plugins/admonitions/github-alert-formation-siblings.test.ts': {
		specifiers: [
			'#lib/editor-actions/block-edit.js',
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/testing/parse-convergence.js'
		],
		reason:
			'no headless editor-actions environment, and parse convergence lives in src/lib/testing ' +
			'without reaching the testing barrel'
	},
	'src/lib/test/plugins/admonitions/github-alert-typed-formation.test.ts': {
		specifiers: [
			'#lib/editor-actions/block-edit.js',
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/testing/parse-convergence.js',
			'#lib/tree-operations/index.js'
		],
		reason:
			'no headless editor-actions environment, no published parse convergence, and nothing published ' +
			'reads a node by path out of a parsed document'
	},
	'src/lib/test/plugins/admonitions/github-alert-unwrap.test.ts': {
		specifiers: ['#lib/tree-operations/index.js', '#lib/schema/editor-grammar.js'],
		reason:
			'nothing published unwraps a child from its quote off a parsed document, or names the grammar the unwrap reads its remainder with'
	},
	'src/lib/test/plugins/details/terminator-collision.test.ts': {
		specifiers: [
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/editor-actions/container-edit.js',
			'#lib/editor-actions/nested/nested-actions.js',
			'#lib/block-lists/block-list-state.svelte.js',
			'#lib/invariants/node-shape.js',
			'#lib/schema/block-kind-descriptor.js'
		],
		reason:
			'no headless editor-actions environment, no published opaque stale-raw predicate, and ' +
			'no registry read-back'
	},
	'src/lib/test/plugins/details/terminator-collision-paste.test.ts': {
		specifiers: [
			'#lib/editor-actions/commit/undo-controller.js',
			'#lib/editor-actions/paste-coordinator.js',
			'#lib/block-lists/state-registry.js'
		],
		reason: 'no headless environment publishes the commit that writes pasted blocks'
	},
	'src/lib/test/plugins/details/terminator-collision-structural.test.ts': {
		specifiers: [
			'#lib/invariants/node-shape.js',
			'#lib/tree-operations/node-ops.js',
			'#lib/tree-operations/sharing.js',
			'#lib/schema/container-writer.js',
			'#lib/schema/editor-grammar.js'
		],
		reason:
			'nothing published splits or joins a parsed document or writes a container alone, and no ' +
			'published opaque stale-raw predicate to hold the result to'
	},
	'src/lib/test/plugins/details/crlf-rebuild.test.ts': {
		specifiers: ['#lib/schema/container-writer.js'],
		reason: 'nothing published writes a container from its line shape outside a commit'
	},
	'src/lib/test/plugins/details/round-trip.test.ts': {
		specifiers: ['#lib/schema/container-writer.js'],
		reason: 'nothing published writes a container from its line shape outside a commit'
	},
	'src/lib/test/plugins/emoji/coexistence.test.ts': {
		specifiers: ['#lib/core/directive/kinds.js'],
		reason:
			'the directive inline level has no published kind name; the plugin barrel publishes the ' +
			'body wrap and the registration entry points only'
	},
	'src/lib/test/plugins/footnotes/definition-split-separator.test.ts': {
		specifiers: [
			'#lib/tree-operations/index.js',
			'#lib/tree-operations/sharing.js',
			'#lib/testing/parse-convergence.js',
			'#lib/schema/container-writer.js'
		],
		reason:
			'nothing published splits a parsed document (nor makes the sharing state the split takes), ' +
			'no published parse convergence, and nothing published writes a container from its line ' +
			'shape outside a commit'
	},
	'src/lib/test/plugins/footnotes/editors.svelte.test.ts': {
		specifiers: ['#lib/perf/instruments.js'],
		reason:
			'the perf instruments are unpublished, and they are what counts the blocks a key asks of `depends`'
	},
	'src/lib/test/plugins/footnotes/reference.test.ts': {
		specifiers: ['#lib/core/inline/inline-widgets.js'],
		reason:
			'no registry read-back: a widget kind registers its component but never reads it, and ' +
			'the read takes a grammar no entry point publishes'
	},
	'src/lib/test/plugins/highlight-occurrences/paint-wiring.svelte.test.ts': {
		specifiers: ['#lib/perf/instruments.js'],
		reason:
			'the perf instruments are unpublished, and they are what counts the blocks a paint was asked for'
	},
	'src/lib/test/plugins/latex/block-edit.property.test.ts': {
		specifiers: [
			'#lib/tree-operations/content-write.js',
			'#lib/schema/own-syntax.js',
			'#lib/schema/block-type.js',
			'#lib/schema/drawing.js',
			'#lib/schema/block-openers.js',
			'#lib/test/invariants/arbitraries/property-seed.js'
		],
		reason:
			'nothing published applies a write the way a leaf commit does, nor hands back a block ' +
			'type’s reshape and paint, and an editor running the plugin reads through a grammar the published `grammar()` keeps to itself; the fixed property seed is the suite’s own helper'
	},
	'src/lib/test/plugins/latex/inline-bounds.test.ts': {
		specifiers: ['#lib/schema/own-syntax.js', '#lib/schema/block-openers.js'],
		reason:
			'a claim inside a range that starts past the block start: an editor running the plugin reads through a grammar the published `grammar()` keeps to itself'
	},
	'src/lib/test/plugins/latex/inline.test.ts': {
		specifiers: [
			'#lib/core/inline/index.js',
			'#lib/core/inline/inline-widgets.js',
			'#lib/schema/own-syntax.js',
			'#lib/schema/block-openers.js'
		],
		reason:
			'no registry read-back for a widget kind, no published core widget shell builder, and ' +
			'an editor running the plugin reads through a grammar the published `grammar()` keeps to itself'
	},
	'src/lib/test/plugins/latex/math-block-writers.test.ts': {
		specifiers: ['#lib/schema/block-type.js', '#lib/schema/plugin-unit.js'],
		reason:
			'no read-back: a block type’s insert row and sample are made but never read back, so an ' +
			'author cannot check the bytes they carry'
	},
	'src/lib/test/plugins/latex/read-table.test.ts': {
		specifiers: [
			'#lib/schema/block-type.js',
			'#lib/schema/plugin-unit.js',
			'#lib/schema/drawing.js'
		],
		reason:
			'nothing published applies a block type’s write rule or hands back its reshape, so the ' +
			'bytes it makes of a write and the shape its source opens in cannot be pinned'
	},
	'src/lib/test/plugins/latex/typed-completion.test.ts': {
		specifiers: [
			'#lib/editor-actions/enter-completion.js',
			'#lib/schema/block-completions.js',
			'#lib/schema/editor-grammar.js',
			'#lib/schema/own-syntax.js',
			'#lib/schema/block-type.js',
			'#lib/schema/block-openers.js'
		],
		reason:
			'a completion is made but nothing published runs one, the Enter handler that consults it ' +
			'has no headless entry, and an editor running the plugin reads through a grammar the published `grammar()` keeps to itself'
	},
	'src/lib/test/plugins/mermaid/draft-cost.svelte.test.ts': {
		specifiers: ['#lib/editor-actions/commit/change-record.js'],
		reason: 'nothing published counts the records a write makes for the drafts held open'
	},
	'src/lib/test/plugins/mermaid/raw-write-rule.test.ts': {
		specifiers: ['#lib/schema/block-type.js', '#lib/schema/plugin-unit.js'],
		reason: 'nothing published applies a block type’s write rule to a write over its bytes'
	},
	'src/lib/test/plugins/mermaid/round-trip.property.test.ts': {
		specifiers: ['#lib/schema/own-syntax.js', '#lib/test/invariants/arbitraries/property-seed.js'],
		reason:
			'an editor running the plugin reads through a grammar the published `grammar()` keeps to ' +
			'itself; the fixed property seed is the suite’s own helper'
	},
	'src/lib/test/plugins/parrot/caption.test.ts': {
		specifiers: ['#lib/schema/block-kind-descriptor.js'],
		reason: "no registry read-back: the kind's caretTargetAtPoint cannot be read back to call"
	},
	'src/lib/test/plugins/slash-commands/slash-harness.ts': {
		specifiers: [
			'#lib/editor-events.js',
			'#lib/inline-menu/inline-menu-state.svelte.js',
			'#lib/schema/insert-catalogue.js',
			'#lib/schema/plugin-activation.js',
			'#lib/schema/plugin-unit.js',
			'#lib/schema/caret-menu.js',
			'#lib/schema/drafts.js',
			'#lib/tree-operations/top-level-starts.js'
		],
		reason:
			'no headless caret-menu session on the testing barrel: typing a trigger and the draft a pick ' +
			"writes through need the editor's own menu state; only an editor's install pass reads a " +
			"plugin value's options and contribution, and only a mounted editor lists the insert rows"
	},
	'src/lib/test/plugins/spellcheck/spelling-action.test.ts': {
		specifiers: ['#lib/schema/plugin-unit.js'],
		reason: "only an editor's install pass reads a plugin value's options and contribution"
	},
	'src/lib/test/plugins/slash-commands/open-command.test.ts': {
		specifiers: ['#lib/schema/plugin-command.js'],
		reason:
			"no read of a command's spec: its chord and its `run` against a stand-in editor are " +
			'reachable only through the schema module that keeps them'
	}
};

// ── The published API ────────────────────────────────────────────────────────

const PUBLISHED_ENTRIES = publishedEntrySources();

const BUNDLED_PLUGINS = new Set(bundledPluginDirs());

/** The plugin whose suite `relPath` belongs to, or null for a platform test sitting loose
 *  under the test root. */
function suiteOf(relPath: string): string | null {
	if (!relPath.startsWith(PLUGIN_TEST_ROOT)) return null;
	const name = relPath.slice(PLUGIN_TEST_ROOT.length).split('/')[0];
	return BUNDLED_PLUGINS.has(name) ? name : null;
}

function isAllowedSpecifier(relPath: string, specifier: string): boolean {
	// A relative path into library code would get around every rule below.
	if (specifier.startsWith('.')) {
		const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), specifier));
		return !resolved.startsWith(SOURCE_DIR.library) || resolved.startsWith(SOURCE_DIR.unitTests);
	}
	if (!isAliasSpelling(specifier)) return true;
	const target = aliasPath(specifier);
	if (target === null) return false;
	if (PUBLISHED_ENTRIES.has(resolveSpecifier(relPath, specifier) ?? '')) return true;
	if (target.startsWith(SOURCE_DIR.testSupport) || target.startsWith(SOURCE_DIR.testHarness)) {
		return true;
	}
	const suite = suiteOf(relPath);
	return suite !== null && target.startsWith(`${SOURCE_DIR.plugins}${suite}/`);
}

interface Reach {
	relPath: string;
	specifier: string;
}

function reachIns(sources: ReturnType<typeof collectEditorSources>): Reach[] {
	const out: Reach[] = [];
	for (const file of sources) {
		if (suiteOf(file.relPath) === null) continue;
		for (const { specifier } of importSpecifiers(file.code)) {
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

	it('every reach-in past the published surface is an allowlisted missing entry point', () => {
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

	it('every allowlist entry names the missing entry point', () => {
		for (const [relPath, exemption] of Object.entries(ALLOWLIST)) {
			expect(exemption.specifiers.length, relPath).toBeGreaterThan(0);
			expect(exemption.reason.length, relPath).toBeGreaterThan(20);
		}
	});
});

// ── Classifier self-tests (non-vacuity) ──────────────────────────────────────

describe('G4.63 classifier non-vacuity', () => {
	const file = `${PLUGIN_TEST_ROOT}details/round-trip.test.ts`;

	it('allows the three published entry points', () => {
		for (const barrel of ['#lib', '#lib/plugin.js', '#lib/testing.js']) {
			expect(isAllowedSpecifier(file, barrel)).toBe(true);
		}
	});

	it('rejects every deep #lib reach-in a rewrite is supposed to remove', () => {
		for (const deep of [
			'#lib/core/parser.js',
			'#lib/core/serializer.js',
			'#lib/core/nodes.js',
			'#lib/schema/registry-reset.js',
			'#lib/editor-actions/commit/undo-controller.js'
		]) {
			expect(isAllowedSpecifier(file, deep)).toBe(false);
		}
	});

	it('allows the suite its own plugin source, and another plugin only where published', () => {
		expect(isAllowedSpecifier(file, '#packages/details/src/index.js')).toBe(true);
		expect(isAllowedSpecifier(file, '#packages/details/src/details-plugin.js')).toBe(true);
		expect(isAllowedSpecifier(file, '#packages/emoji/src/index.js')).toBe(true);
		expect(isAllowedSpecifier(file, '#packages/emoji/src/emoji-plugin.js')).toBe(false);
	});

	it('allows the copyable test support and any npm package', () => {
		expect(isAllowedSpecifier(file, '#lib/test/support/warn-gate.js')).toBe(true);
		expect(isAllowedSpecifier(file, '#lib/test/harness/editor-actions.js')).toBe(true);
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
		expect(isAllowedSpecifier(file, '#packages/emoji/src/emoji-plugin.js')).toBe(false);
	});

	it('binds per-plugin suites only, leaving the loose platform tests alone', () => {
		expect(suiteOf(`${PLUGIN_TEST_ROOT}details/round-trip.test.ts`)).toBe('details');
		expect(suiteOf(`${PLUGIN_TEST_ROOT}kind-conformance.test.ts`)).toBe(null);
		expect(suiteOf(`${PLUGIN_TEST_ROOT}fixtures/showcase.ts`)).toBe(null);
	});
});
