// Miss-analysis: the kit wrote a container's title row in no cell, so a kind keeping its title in
// metadata passed while a title keystroke, which skips the metadata re-read, left it stale.
import { describe, it, expect, beforeEach } from 'vitest';
import { installPlugins } from '$lib';
import {
	activateDirectives,
	chromeChild,
	createDirectiveRebuild,
	declarePluginKind,
	DIRECTIVE_BODY_WRAP,
	registerBlockKind,
	registerChromeLeaf,
	registerDirective,
	setPluginMetadata,
	type CstNode,
	type ParsedDirective,
	type PluginBlockKind
} from '$lib/plugin';
import {
	resetPluginPlatformForTests,
	runContainerConformance,
	type ContainerConformanceProfile
} from '$lib/testing';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { testClosure } from '$lib/test/support/closure';
import { registerCalloutKind, CALLOUT } from '../../../routes/test/plugins/callout/callout-kind';

interface TitledMetadata {
	title: string;
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
	lineEnding: string;
}

// Breaks the title-row promise on purpose: the opener copies the title into metadata.
function registerTitledKind(): PluginBlockKind {
	activateDirectives();
	const kind = declarePluginKind('titled');
	const titleKind = declarePluginKind('titled-title');
	registerChromeLeaf(titleKind);
	registerDirective('container', 'titled', {
		kind,
		fromDirective: (parsed: ParsedDirective): CstNode => {
			const title = parsed.fence.info.trim();
			const node: CstNode = {
				kind,
				leadingTrivia: parsed.leadingTrivia,
				raw: parsed.raw,
				innerPrefix: parsed.body?.prefix ?? '',
				children: [chromeChild(titleKind, title), ...(parsed.body?.children ?? [])],
				innerSuffix: parsed.body?.suffix ?? ''
			};
			setPluginMetadata<TitledMetadata>(node, {
				title,
				colonCount: parsed.fence.colonCount,
				closerColonCount: parsed.closerColonCount,
				closerNewline: parsed.closerNewline,
				lineEnding: parsed.lineEnding
			});
			return node;
		}
	});
	registerBlockKind(kind, {
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			contract: 'opaque',
			rebuildRaw: createDirectiveRebuild<TitledMetadata>(() => 'titled'),
			bodyWrap: DIRECTIVE_BODY_WRAP,
			reservedChrome: { kind: titleKind },
			unwrapRole: { middleChildBackspace: 'default-merge' }
		},
		conformanceFixture: ':::titled T\n\nbody\n\n:::\n',
		closure: testClosure
	});
	return kind;
}

const EXCUSED = 'excused here: this suite is about the title row, which runs for every kind';

const profileFor = (source: string): ContainerConformanceProfile => ({
	deepNesting: { source, leafPath: [0, 1] },
	terminatorCollisionFixture: { source, bodyRaw: 'before\n:::\nafter\n' },
	localIndex: { mode: 'exempt', reason: EXCUSED },
	ancestry: { mode: 'assert' },
	multiScope: { mode: 'exempt', reason: EXCUSED },
	focusBubble: { mode: 'exempt', reason: EXCUSED },
	terminatorCollision: { mode: 'assert' }
});

describe('the container kit writes the title row (#640)', () => {
	beforeEach(() => resetPluginPlatformForTests());

	it('fails a kind whose metadata copies its title row', async () => {
		const kind = registerTitledKind();
		await expect(
			runContainerConformance(kind, profileFor(':::titled T\nbody\n:::\n'))
		).rejects.toThrow(/titleRow: .*titled\.title: live "T" != reparsed/);
	});

	it.each([
		['the callout', () => (registerCalloutKind(), CALLOUT), ':::callout T\nbody\n:::\n'],
		[
			'an admonition',
			() => (installPlugins([admonitionsPlugin()]), 'admonition'),
			':::note T\nbody\n:::\n'
		]
	])('passes %s, whose title row feeds no metadata', async (_label, register, source) => {
		const kind = register();
		const { cells } = await runContainerConformance(kind as PluginBlockKind, profileFor(source));
		expect(cells.find((c) => c.cell === 'titleRow')?.status).toBe('asserted');
	});

	it('excuses a container with no title row, saying why', async () => {
		installPlugins([admonitionsPlugin()]);
		const { cells } = await runContainerConformance('directiveContainer' as PluginBlockKind, {
			...profileFor(':::spoiler\nbody\n:::\n'),
			deepNesting: { source: ':::spoiler\nbody\n:::\n', leafPath: [0, 0] }
		});
		expect(cells.find((c) => c.cell === 'titleRow')).toMatchObject({ status: 'exempt' });
	});
});
