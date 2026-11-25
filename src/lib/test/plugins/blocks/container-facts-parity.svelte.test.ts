// @vitest-environment jsdom
// The facts the container maker derives against a bundled container's hand registration: a twin
// built with `container` reads the same cut, copy and paste facts and the same Backspace, gap and
// drag answers, so L8's rewrite of each package onto the maker keeps them.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import { QUOTE_LINES } from '#lib/core/parsers/blockquote.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { blockFacts } from '#lib/schema/block-facts.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { unwrapRoleOf } from '#lib/schema/reserved-chrome.js';
import { container } from '#lib/components/block-makers/container.js';
import { builtin } from '#lib/components/block-makers/builtin.js';
import type { BlockType } from '#lib/schema/plugin-unit.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { registeredAdmonitions } from '#lib/test/harness/registered-admonitions.js';
import { registeredFootnotes } from '#lib/test/harness/registered-footnotes.js';

beforeAll(() => installLayoutStubs());
// Each test starts with the registries reset, so the hand-registered kinds go in again.
beforeEach(() => installPlugins([registeredAdmonitions(), registeredFootnotes()]));
afterEach(destroyMountedEditors);

const TWINS: { kind: string; twin: BlockType<unknown> }[] = [
	{
		kind: 'githubAlert',
		twin: container<{ alertType: string }>({
			name: 'alert',
			label: 'Alert',
			lines: {
				...QUOTE_LINES,
				head: {
					match: /^[ \t]*\[!([A-Za-z]+)\][ \t]*$/,
					data: (match) => ({ alertType: match[1] }),
					write: (data) => `[!${data.alertType}]`
				}
			},
			merges: { key: 'alertType' },
			interrupts: true,
			before: builtin.blocks.blockquote,
			sample: '> [!NOTE]\n> Heads up.',
			insert: { none: 'a test block type' }
		})
	},
	{
		kind: 'footnote-def',
		twin: container<{ label: string }>({
			name: 'footnote',
			label: 'Footnote',
			lines: {
				shape: 'indented',
				open: /^ {0,3}\[\^([^\]]+)\]: ?/,
				data: (match) => ({ label: match[1] }),
				first: (data) => `[^${data.label}]: `,
				rest: () => '    ',
				lazy: true
			},
			joins: false,
			merges: { key: 'label' },
			before: builtin.blocks.linkReferenceDefinition,
			sample: '[^1]: A footnote definition.\n    with an indented continuation.',
			insert: { none: 'a test block type' }
		})
	}
];

/** What the editor's systems read of a kind, its own name left out. */
function factsOf(kind: string) {
	const facts = blockFacts(kind);
	const d = tryGetBlockKindDescriptor(kind as AnyBlockKind)!;
	return {
		...facts,
		merges: { ...facts.merges, into: facts.merges.into.map((k) => (k === kind ? 'self' : k)) },
		pageRole: d.pageRole ?? 'object',
		gapEdges: d.gapEdges,
		mergeRole: d.mergeRole,
		unwrapRole: unwrapRoleOf(kind as AnyBlockKind),
		reorders: d.reorderChildren !== undefined,
		contract: d.containerContract,
		bodyWrap: d.bodyWrap,
		editable: d.editable,
		supportsInline: d.supportsInline
	};
}

describe('a twin made by the container maker', () => {
	it.each(TWINS)('reads $kind’s facts', async ({ kind, twin }) => {
		const twins = definePlugin({
			name: 'twins',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ blocks: [twin] })
		});
		const m = mountEditor({ source: 'x\n', plugins: [twins] });
		await m.settle();
		expect(factsOf(twin.name)).toEqual(factsOf(kind));
	});
});
