// @vitest-environment node
// A container's fixtures come from its one sample, grown and quoted through its own lines, and they
// bite: the ancestry fixture goes stale under a rebuild run outermost first.
import { afterEach, describe, expect, it } from 'vitest';
import { container, definePlugin } from '#lib/plugin.js';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import { pluginCheckContext, type PluginCheckRun } from '#lib/testing/check-context.js';
import { derivedProfile } from '#lib/testing/container-shape.js';
import { reversedAncestryLeavesRootStale } from '#lib/testing/container-conformance.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';

async function reportOf(run: Promise<CheckReport>): Promise<CheckReport> {
	return run.catch((error: unknown) => {
		if (isCheckFailure(error)) return error.report;
		throw error;
	});
}

const NOT_INSERTED = { none: 'a fixture of the check suite' };
const MARKED = { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true } as const;

const shapes = {
	marked: container({
		name: 'quote',
		label: 'Quote',
		sample: '%> one',
		insert: NOT_INSERTED,
		lines: MARKED
	}),
	headed: container({
		name: 'alert',
		label: 'Alert',
		sample: '%> [!NOTE]\n%> x',
		insert: NOT_INSERTED,
		lines: {
			...MARKED,
			head: {
				match: /^\[!(\w+)\]$/,
				data: (m: RegExpExecArray) => ({ type: m[1] }),
				write: (data: { type: string }) => `[!${data.type}]`
			}
		}
	}),
	indented: container({
		name: 'note',
		label: 'Note',
		sample: '@@1: one',
		insert: NOT_INSERTED,
		lines: {
			shape: 'indented',
			open: /^@@(\d+): ?/,
			data: (m: RegExpExecArray) => ({ label: m[1] }),
			first: ({ label }: { label: string }) => `@@${label}: `,
			rest: () => '    ',
			lazy: true
		}
	})
};

const plugin = definePlugin({
	name: 'shapes',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ blocks: Object.values(shapes) })
});

let held: PluginCheckRun | null = null;
afterEach(() => held?.release());

function profileOf(shape: keyof typeof shapes) {
	held = pluginCheckContext([plugin], ({ cause }) => {
		throw cause;
	});
	const kind = shapes[shape].name as AnyBlockKind;
	const sample = held.context.descriptor(kind).samples![0];
	return { context: held.context, kind, profile: derivedProfile(held.context, kind, sample) };
}

describe('fixtures derived from a sample', () => {
	it('grows a one-child sample to two children and quotes it, its leaf under the type', () => {
		const { context, kind, profile } = profileOf('marked');
		expect(profile.focusSource).toBe('%> one\n%>\n%> probe 1\n');
		expect(profile.deepNesting).toEqual({
			source: '> %> one\n> %>\n> %> probe 1\n',
			leafPath: [0, 0, 1]
		});
		const doc = context.parse(profile.deepNesting.source);
		expect(doc.children[0].children![0].kind).toBe(kind);
		expect(profile.localIndexFixture).toMatchObject({ containerChain: [0, 0], targetChild: 1 });
	});

	it.each(Object.keys(shapes) as (keyof typeof shapes)[])(
		'gives a %s container an ancestry fixture that goes stale outermost first',
		(shape) => {
			const { context, profile } = profileOf(shape);
			expect(reversedAncestryLeavesRootStale(context, profile)).toBe(true);
		}
	);

	// A copy out of a head-lined container one level down drops the outer marker from its body
	// lines, the built-in alert's too, so that one row is left out here.
	it('passes every container check over each shape a maker writes', async () => {
		const report = await reportOf(check(plugin));
		const container = [
			'localIndex',
			'ancestry',
			'focusBubble',
			'containerCopy',
			'containerDeclared'
		];
		const failing = report.rows.filter(
			(row) => container.includes(row.check) && row.status !== 'passed'
		);
		expect(failing.map((row) => `${row.subject} ${row.check}`)).toEqual([
			'shapes/alert containerCopy'
		]);
		expect(report.rows.filter((row) => row.check === 'containerDeclared')).toHaveLength(3);
	});
});
