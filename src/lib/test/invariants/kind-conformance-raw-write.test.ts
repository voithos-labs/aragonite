// The kind kit's raw-write cell: a kind that declares `rawWrite` has its rule driven
// through truncating writes over its fixture, and a kind without one must survive its closer's cut.
// Miss-analysis: the cell exempted every kind with no rule, so a fenced kind that never declared
// one passed the kit while a range delete over its closer swallowed the document below.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	declaredPluginKind,
	matchFenceClose,
	matchFenceOpen,
	OPENER_PRIORITIES,
	registerBlockOpener
} from '$lib/plugin';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { fencedCodeWrite } from '$lib/schema/fenced-code-raw';
import type { WriteRule } from '$lib/schema/block-kind-descriptor';
import { resetPluginPlatformForTests, runKindConformance } from '$lib/testing';
import { checkLeafRawWrite } from '$lib/testing/kind-conformance';
import { registerMathBlock, MATH_BLOCK, MATH_FENCE } from '$lib/plugins/latex/latex-kind';
import { registerMermaidKind, MERMAID } from '$lib/plugins/mermaid/mermaid-kind';
import type { AnyBlockKind } from '$lib/core/nodes';
import { testLeaf } from '$lib/test/harness/test-kinds';

beforeEach(() => {
	resetPluginPlatformForTests();
	registerMathBlock();
	registerMermaidKind();
});

describe('kind conformance: the raw-write cell', () => {
	it.each([
		(): AnyBlockKind => 'fencedCode',
		() => declaredPluginKind(MATH_BLOCK),
		() => declaredPluginKind(MATH_FENCE),
		() => declaredPluginKind(MERMAID)
	])('executes for a declaring kind (%#)', async (kindOf) => {
		const report = await runKindConformance(kindOf());
		expect(report.rawWrite.status).toBe('executed');
	});

	it('executes the closer cut for a kind that declares no rule', async () => {
		const report = await runKindConformance('paragraph');
		expect(report.rawWrite.status).toBe('executed');
	});

	// A declarer the kit has no fixture to write over is recorded, never reported green.
	it('is boundary for a declaring kind with no top-level fixture', async () => {
		const report = await runKindConformance('tableCell');
		expect(report.rawWrite.status).toBe('boundary');
	});
});

// A fenced leaf whose raw is its own lines and which declares no rule: cutting its closer leaves an
// unterminated fence that reads every block below it as its body.
function registerRulelessFence(): AnyBlockKind {
	const kind = testLeaf('ruleless-fence', {
		editable: false,
		conformanceFixture: '```ruleless\nbody\n```\n'
	});
	registerBlockOpener(kind, {
		priority: OPENER_PRIORITIES.fencedCode - 5,
		interruptsParagraph: false,
		tryOpen(ctx) {
			const fence = matchFenceOpen(ctx.line.text);
			if (!fence || fence.info !== 'ruleless') return null;
			let end = ctx.index + 1;
			while (end < ctx.end && !matchFenceClose(ctx.lines[end].text, fence.marker, fence.length)) {
				end++;
			}
			end = Math.min(end + 1, ctx.end);
			const raw = ctx.lines
				.slice(ctx.index, end)
				.map((line) => line.raw)
				.join('');
			const node = { kind, leadingTrivia: ctx.leadingTrivia, raw, children: [] };
			return { node, consumed: end - ctx.index };
		}
	});
	return kind;
}

describe('kind conformance: the raw-write cell fails a kind that needs a rule and has none', () => {
	it('fails a fenced kind whose closing line cut swallows the next block', async () => {
		const kind = registerRulelessFence();
		await expect(runKindConformance(kind)).rejects.toThrow(
			/rawWrite: .*the closing line cut .*swallows the next block/
		);
	});
});

describe('kind conformance: the raw-write cell fails a broken rule', () => {
	const fixture = getBlockKindDescriptor('fencedCode').conformanceFixture!;
	const keepsOffsets = (normalize: WriteRule['normalize']): WriteRule => ({
		normalize,
		mapOffset: (_raw, offset) => offset
	});

	it('fails a rule that drops the closer', () => {
		const dropsCloser = keepsOffsets((raw, ctx) =>
			fencedCodeWrite.normalize(raw, ctx).replace(/```\n$/, '')
		);
		expect(() => checkLeafRawWrite('fencedCode', fixture, dropsCloser)).toThrow(
			/the closing line cut/
		);
	});

	it('fails a rule that repairs nothing', () => {
		expect(() =>
			checkLeafRawWrite(
				'fencedCode',
				fixture,
				keepsOffsets((raw) => raw)
			)
		).toThrow(/the closing line cut/);
	});

	it('fails a rule that is not idempotent', () => {
		const grows = keepsOffsets((raw) => raw + 'x');
		expect(() => checkLeafRawWrite('fencedCode', fixture, grows)).toThrow(/idempotent/);
	});

	it('fails a caret map that moves an offset the rule left alone', () => {
		const drifts: WriteRule = { ...fencedCodeWrite, mapOffset: (_raw, offset) => offset + 1 };
		expect(() => checkLeafRawWrite('fencedCode', fixture, drifts)).toThrow(/at 0 .* stays/);
	});

	it('fails a caret map that ignores the bytes the rule inserted before an offset', () => {
		const indents = keepsOffsets((raw) => (raw.startsWith(' ') ? raw : ' ' + raw));
		expect(() => checkLeafRawWrite('fencedCode', fixture, indents)).toThrow(
			/at 1 .* moves by what the rule changed/
		);
	});
});
