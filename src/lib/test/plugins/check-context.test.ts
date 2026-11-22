// @vitest-environment jsdom
// The conformance cells read through the context they are handed: a plugin value's block type and
// inline are checked under its own editor's grammar, which the default grammar can't read.
import { afterEach, describe, expect, it } from 'vitest';
import { definePlugin, inline, lineBlock } from '#lib/plugin.js';
import type { AnyBlockKind, AnyInlineKind } from '#lib/core/nodes.js';
import { defaultCheckContext, pluginCheckContext } from '#lib/testing/check-context.js';
import { runKindCells } from '#lib/testing/kind-conformance.js';
import { runInlineCells, type InlineConformanceProfile } from '#lib/testing/inline-conformance.js';

const NO_WIDGET = 'the construct draws its bytes with a class, so it has no widget';

function installed() {
	const memo = lineBlock({
		name: 'memo',
		label: 'Memo',
		sample: ['%%a memo', '%%another'],
		insert: { none: 'a fixture of the check-context suite' },
		match: /^%%(?<text>.*)$/
	});
	const tag = inline<string>({
		name: 'tag',
		label: 'Tag',
		prefix: '#',
		sample: 'a #tag here',
		match: /#[a-z]+/,
		read: (match) => match[0],
		class: 'tag'
	});
	const plugin = definePlugin({
		name: 'ctx',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [memo], inlines: [tag] })
	});
	const problems: unknown[] = [];
	const held = pluginCheckContext([plugin], ({ cause }) => problems.push(cause));
	expect(problems).toEqual([]);
	return { ...held, memo: memo.name as AnyBlockKind, tag: tag.name as AnyInlineKind };
}

const tagProfile = (kind: AnyInlineKind): InlineConformanceProfile => ({
	trigger: '#',
	kind,
	fixtures: ['a #tag here'],
	overlapDecline: { mode: 'exempt', reason: 'no built-in construct starts with this character' },
	widget: { mode: 'exempt', reason: NO_WIDGET },
	editingPolicy: { mode: 'exempt', reason: NO_WIDGET },
	imageClaim: { mode: 'exempt', reason: 'the construct builds only its own inline kind' }
});

let release = (): void => {};
afterEach(() => release());

describe('a conformance cell reads through its context', () => {
	it('checks a plugin value block type under its own grammar', async () => {
		const held = installed();
		release = held.release;
		const report = await runKindCells(held.context, held.memo);
		const asserted = report.cells.filter((cell) => cell.status === 'asserted').map((c) => c.cell);
		expect(asserted).toEqual(expect.arrayContaining(['roundTrip', 'undo', 'clipboard']));
	});

	it('fails the same block type under the default grammar, which reads its sample as text', async () => {
		const held = installed();
		release = held.release;
		await expect(runKindCells(defaultCheckContext, held.memo)).rejects.toThrow(
			/sample parses to no "ctx\/memo" node/
		);
	});

	// Miss-analysis: every cell handed the headless actions a parsed document but the opener-line
	// cell, which hands text, and no row read that text back under a plugin's grammar.
	it('reads text handed to the headless actions under its own grammar', () => {
		const held = installed();
		release = held.release;
		expect(held.context.headless('%%a memo\n').doc.children[0].kind).toBe(held.memo);
	});

	it('keeps every sample a block type and an inline declare', () => {
		const held = installed();
		release = held.release;
		expect(held.context.descriptor(held.memo).samples).toEqual(['%%a memo\n', '%%another\n']);
		expect(held.context.grammar.inlines?.().get(held.tag)?.samples).toEqual(['a #tag here']);
	});

	it('checks a plugin value inline under its own grammar, and finds none under the default', async () => {
		const held = installed();
		release = held.release;
		const report = await runInlineCells(held.context, tagProfile(held.tag));
		expect(report.cells.find((cell) => cell.cell === 'claims')?.status).toBe('asserted');
		await expect(runInlineCells(defaultCheckContext, tagProfile(held.tag))).rejects.toThrow(
			/no rung is registered on "#"/
		);
	});
});
