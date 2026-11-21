// One editor's inline table: what its parse asks at each character, built once per change and
// holding only the plugins that editor runs.
// Miss-analysis: the parse read one table for the page and asked each handler's plugin at every
// position, so nothing pinned that an editor's own list decides what it reads.
import { describe, expect, it } from 'vitest';
import { parseInline } from '#lib';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { registerInlineSyntax } from '#lib/core/inline/scan/plugin-syntax.js';
import { addCoreInlineHandler, inlineTable } from '#lib/core/inline/scan/inline-table.js';
import { createEditorGrammar } from '#lib/schema/editor-grammar.js';
import { activationFor } from '#lib/schema/plugin-activation.js';
import type { InlineNode } from '#lib';

const percent = definePlugin({
	name: 'percent',
	setup() {
		registerInlineSyntax('%', (raw, pos) => ({
			kind: 'percent' as InlineNode['kind'],
			start: pos,
			end: pos + 1
		}));
	}
});

const listing = (names: string[]) => createEditorGrammar({ plugins: activationFor(names) });

describe('an editor’s inline table', () => {
	it('is the same object until a handler or the plugin list changes', () => {
		const grammar = listing(['percent']);
		const before = inlineTable(grammar);
		expect(inlineTable(grammar)).toBe(before);
		installPlugins([percent]);
		const after = inlineTable(grammar);
		expect(after).not.toBe(before);
		expect(inlineTable(grammar)).toBe(after);
	});

	it('holds a plugin’s handler only where the editor runs the plugin', () => {
		installPlugins([percent]);
		const on = listing(['percent']);
		const off = listing([]);
		expect(inlineTable(on).handlers('%')).toHaveLength(1);
		expect(inlineTable(off).handlers('%')).toHaveLength(0);
		const kinds = (grammar: ReturnType<typeof listing>) =>
			parseInline('a % b', 0, 5, undefined, grammar).map((n) => n.kind);
		expect(kinds(on)).toEqual(['text', 'percent', 'text']);
		expect(kinds(off)).toEqual(['text']);
	});

	it('gives every editor the core’s handlers, ahead of a plugin’s on the same character', () => {
		installPlugins([percent]);
		const core = (raw: string, pos: number): InlineNode => ({
			kind: 'core' as InlineNode['kind'],
			start: pos,
			end: pos + 1
		});
		addCoreInlineHandler('%', core);
		expect(
			inlineTable(listing([]))
				.handlers('%')
				.map((h) => h.recognizer)
		).toEqual([core]);
		expect(inlineTable(listing(['percent'])).handlers('%')[0].recognizer).toBe(core);
	});
});
