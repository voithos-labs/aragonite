// Miss-analysis (#576): the kind-check fix covered the grid drivers only, and no test pointed a
// strip or inline cell at a fixture whose checked node was some other kind.
import { beforeEach, describe, expect, it } from 'vitest';
import {
	declarePluginInlineKind,
	mintWidgetShell,
	registerBlockOpener,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type CstNode,
	type PluginBlockKind,
	type PluginInlineKind
} from '$lib/plugin';
import {
	resetPluginPlatformForTests,
	runContainerConformance,
	runInlineKindConformance,
	type ContainerConformanceProfile,
	type InlineConformanceProfile
} from '$lib/testing';
import { testContainer, testLeaf } from '$lib/test/harness/test-kinds';
import { registerWikiRung, rewriteWikiImage } from '../image/wiki-image-rung';

const EXCUSED = 'the plugin kind in this suite exists only to probe the cell it asserts';

// Each `%` line is one child; the rebuild writes garbage, so no honest delete over it converges.
function registerCorruptStrip(): PluginBlockKind {
	const line = testLeaf('subject-strip-line');
	const strip = testContainer('subject-strip', {
		contract: 'strip',
		rebuildRaw: (node) => {
			node.raw = 'corrupted\n';
		}
	});
	registerBlockOpener(strip, {
		priority: 45,
		interruptsParagraph: false,
		tryOpen(ctx) {
			let end = ctx.index;
			while (end < ctx.end && ctx.lines[end].text.startsWith('%')) end++;
			if (end === ctx.index) return null;
			const lines = ctx.lines.slice(ctx.index, end);
			const children: CstNode[] = lines.map((l) => ({ kind: line, leadingTrivia: '', raw: l.raw }));
			const raw = lines.map((l) => l.raw).join('');
			return {
				node: { kind: strip, leadingTrivia: ctx.leadingTrivia, raw, children },
				consumed: end - ctx.index
			};
		}
	});
	return strip;
}

describe('container kit: the localIndex cell checks the kind it was given', () => {
	beforeEach(() => resetPluginPlatformForTests());

	// The chain lands on the nested blockquote, which addresses correctly; the plugin kind sits
	// after it in the same document.
	it('fails a chain that lands on a built-in container instead of the plugin kind', async () => {
		const strip = registerCorruptStrip();
		const source = '> a\n>\n> > b\n> >\n> > c\n\n% x\n% y\n';
		const profile: ContainerConformanceProfile = {
			deepNesting: { source, leafPath: [1, 0] },
			localIndexFixture: { source, containerChain: [0, 1], targetChild: 1 },
			localIndex: { mode: 'assert' },
			ancestry: { mode: 'boundary', reason: EXCUSED },
			multiScope: { mode: 'exempt', reason: EXCUSED },
			focusBubble: { mode: 'boundary', reason: EXCUSED },
			terminatorCollision: { mode: 'exempt', reason: EXCUSED }
		};
		await expect(runContainerConformance(strip, profile)).rejects.toThrow(
			/localIndex: .*"blockquote" at \[0,1\], not the "subject-strip" under test/
		);
	});
});

// An inline syntax handler that creates only built-in images, run under a profile naming a widget
// kind it never creates.
describe('inline kit: a cell about the kind checks nodes of that kind', () => {
	let marker: PluginInlineKind;
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerWikiRung(rewriteWikiImage);
		marker = declarePluginInlineKind('subject-marker');
		registerInlineSyntax('@', (raw, pos, end) => {
			const close = raw.indexOf('@', pos + 1);
			if (close < 0 || close + 1 > end || close === pos + 1) return null;
			return { kind: marker, start: pos, end: close + 1 };
		});
		registerInlineWidgetKind(marker, {
			isWidget: () => true,
			buildWidget: (node) => mintWidgetShell('subject-marker', node),
			editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
		});
	});

	const profile = (cell: 'widget' | 'editingPolicy'): InlineConformanceProfile => ({
		trigger: '!',
		prefix: '![[',
		kind: marker,
		fixtures: ['![[cat.png]]'],
		overlapFixtures: ['![[a]](u)'],
		overlapDecline: { mode: 'assert' },
		widget: { mode: 'exempt', reason: EXCUSED },
		editingPolicy: { mode: 'exempt', reason: EXCUSED },
		imageClaim: { mode: 'assert' },
		[cell]: { mode: 'assert' }
	});

	it.each(['widget', 'editingPolicy'] as const)(
		'fails %s over fixtures that mint no node of the kind',
		async (cell) => {
			await expect(runInlineKindConformance(profile(cell))).rejects.toThrow(
				new RegExp(`${cell}: no fixture mints a "subject-marker" node`)
			);
		}
	);
});
