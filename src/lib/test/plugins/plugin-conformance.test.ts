// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { activateDirectives, definePlugin, type EditorPlugin } from '#lib/plugin.js';
import { configureEditorEnv, resetEditorEnv, runPluginConformance } from '#lib/testing.js';
import { devWarn } from '#lib/dev-checks.js';
import type { PluginBlockKind } from '#lib/core/nodes.js';
import type { OpenContext } from '#lib/schema/block-openers.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { testView } from '#lib/test/harness/test-view.js';
import { registerCalloutKind, CALLOUT } from '../../../routes/test/plugins/callout/callout-kind';
import { emojiPlugin, EMOJI_KIND } from '#packages/emoji/src/index.js';

/** A one-line leaf opened by `marker`; with `toEnd`, it reads on to the document's end instead,
 *  so cutting its closing line swallows the block below. */
function markerLeaf(marker: string, toEnd = false) {
	return (kind: PluginBlockKind) => ({
		conformanceFixture: toEnd ? `${marker} a\nbody\n` : `${marker} hello\n`,
		opener: {
			priority: 25,
			interruptsParagraph: false as const,
			tryOpen: (ctx: OpenContext) => {
				if (!ctx.line.text.startsWith(marker)) return null;
				const lines = ctx.lines.slice(ctx.index, toEnd ? ctx.end : ctx.index + 1);
				const raw = lines.map((line) => line.raw).join('');
				return { node: { kind, leadingTrivia: ctx.leadingTrivia, raw }, consumed: lines.length };
			}
		}
	});
}

const plugin = (name: string, setup: () => void): EditorPlugin => definePlugin({ name, setup });

afterEach(() => resetEditorEnv());

describe('runPluginConformance', () => {
	it('checks every block kind the suite plugins declare, and nothing else', async () => {
		const pair = plugin('pair', () => {
			testLeaf('pair-a', markerLeaf('%%a'));
			testLeaf('pair-b', markerLeaf('%%b'));
		});
		const report = await runPluginConformance({ plugins: [pair] });
		expect(report.plugins).toEqual(['pair']);
		expect(report.kinds.map((k) => k.kind)).toEqual(['pair-a', 'pair-b']);
	});

	it("leaves out the editor's own kinds a plugin's setup switches on", async () => {
		const directives = plugin('directive-user', () => activateDirectives());
		expect((await runPluginConformance({ plugins: [directives] })).kinds).toEqual([]);
	});

	it('names the kind, the cell and the contract a failure breaks', async () => {
		const swallows = plugin('swallows', () => {
			testLeaf('swallow', markerLeaf('%%s', true));
		});
		const run = runPluginConformance({ plugins: [swallows] });
		await expect(run).rejects.toThrow(/plugin conformance failed for "swallows"/);
		await expect(runPluginConformance({ plugins: [swallows] })).rejects.toThrow(
			/kind conformance failed for "swallow"[\s\S]*rawWrite: [\s\S]*breaks: any bytes written into your block leave the blocks around it alone \(plugin-testing\.md#the-kind-checkup-runkindconformance\)/
		);
	});

	it('fails a container kind the suite gives no profile', async () => {
		const callout = plugin('callout-unprofiled', () => registerCalloutKind(testView()));
		await expect(runPluginConformance({ plugins: [callout] })).rejects.toThrow(
			`container kind "${CALLOUT}" has no profile in the suite's containers`
		);
	});

	it('fails a container profile naming a kind the plugins never declared', async () => {
		const pair = plugin('pair-stale', () => testLeaf('stale-a', markerLeaf('%%a')));
		const profile = {} as never;
		await expect(
			runPluginConformance({ plugins: [pair], containers: { ghost: profile } })
		).rejects.toThrow('containers names "ghost", which these plugins declare no container as');
	});

	it('fails an inline kind the suite gives no profile', async () => {
		await expect(runPluginConformance({ plugins: [emojiPlugin()] })).rejects.toThrow(
			`inline kind "${EMOJI_KIND}" has no profile in the suite's inline`
		);
	});

	it('runs an inline profile that names its kind before the kind exists', async () => {
		const report = await runPluginConformance({
			plugins: [emojiPlugin()],
			inline: [
				{
					trigger: ':',
					priority: 110,
					kind: EMOJI_KIND,
					fixtures: [':smile:'],
					overlapFixtures: ['meet at 10:30'],
					overlapDecline: { mode: 'assert' },
					widget: { mode: 'assert' },
					editingPolicy: { mode: 'assert' },
					imageClaim: { mode: 'exempt', reason: 'the rung builds only its own inline kind' }
				}
			]
		});
		expect(report.inline.map((r) => r.cells.every((c) => c.status !== 'boundary'))).toEqual([true]);
	});

	it('fails on a dev warning raised while the plugin installs', async () => {
		const noisy = plugin('noisy', () => devWarn('noisy-tag', 'something the author should see'));
		await expect(runPluginConformance({ plugins: [noisy] })).rejects.toThrow(
			'dev warning [noisy-tag]: something the author should see'
		);
	});

	it('refuses to run with dev checks off, since a warning would pass unseen', async () => {
		configureEditorEnv({ isDev: false });
		const quiet = plugin('quiet', () => devWarn('quiet-tag', 'never heard'));
		await expect(runPluginConformance({ plugins: [quiet] })).rejects.toThrow('dev checks are off');
	});

	it('passes a plugin that declares no kind, with an empty report', async () => {
		const empty = plugin('empty-kinds', () => {});
		expect(await runPluginConformance({ plugins: [empty] })).toEqual({
			plugins: ['empty-kinds'],
			kinds: [],
			containers: [],
			inline: []
		});
	});
});
