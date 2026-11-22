/**
 * `check`'s rows over what a plugin lays over the document: `paintRanges` places each `Paint` its
 * `paint` answers for a sample the way the editor places it, and `codeTokens` nests each token its
 * highlighter answers the way the editor draws them. The editor's own rule decides both; a paint it
 * leaves out says so in a dev warning, which fails the row.
 */

import { walkBlocks } from '../core/paths';
import { createPaintSource } from '../decorations/plugin-paint.svelte';
import type { Paint } from '../decorations/paint';
import { nestedTokens } from '../schema/code-highlighter';
import type { Block } from '../schema/doc-view';
import type { Contribution } from '../schema/plugin-unit';
import type { PluginCheck } from './check-names';
import type { PluginCheckRun } from './check-context';
import type { Outcome } from './inline-check';
import { show } from './conformance-core';

type Warnings = readonly { readonly tag: string; readonly message: string }[];

/** The plugin rows for what `own` lays over the document: only those it lists a way to lay. */
export async function paintOutcomes(
	run: PluginCheckRun,
	plugin: string,
	own: Contribution | undefined,
	warnings: Warnings,
	warningsFail: boolean
): Promise<[PluginCheck, Outcome][]> {
	const out: [PluginCheck, Outcome][] = [];
	const samples = [
		...run.context.builtInSamples(),
		...run.kinds.flatMap((kind) => run.context.descriptor(kind).samples ?? [])
	];
	if (own?.paint || own?.paintContainer) {
		out.push(['paintRanges', paintRanges(run, plugin, own, samples, warnings, warningsFail)]);
	}
	if (own?.code) out.push(['codeTokens', await codeTokens(own.code, samples.join('\n'))]);
	return out;
}

// ── Internal ─────────────────────────────────────────────────────────────────

const failed = (detail: string): Outcome => ({ status: 'failed', detail });
const messageOf = (error: unknown) => (error as Error)?.message ?? String(error);

/** Each block of each sample asked through the editor's paint source, as a block on screen is. */
function paintRanges(
	run: PluginCheckRun,
	plugin: string,
	own: Contribution,
	samples: readonly string[],
	warnings: Warnings,
	warningsFail: boolean
): Outcome {
	const before = warnings.length;
	let painted = 0;
	const threw: string[] = [];
	const asked = (
		paint: ((block: Block, ctx: never) => readonly Paint[]) | undefined,
		doing: string
	) =>
		paint &&
		((block: Block, ctx: never) => {
			try {
				const answer = paint(block, ctx);
				painted += answer?.length ?? 0;
				return answer;
			} catch (error) {
				threw.push(`${doing} threw over ${show(block.text)}: ${messageOf(error)}`);
				throw error;
			}
		});
	for (const sample of samples) {
		const stage = run.stage(sample);
		const source = createPaintSource<Block>({
			plugin,
			contribution: {
				paint: asked(own.paint as never, 'paint'),
				paintContainer: asked(own.paintContainer as never, 'paintContainer'),
				paintDepends: own.paintDepends
			},
			blockOf: stage.blockOf,
			blockAt: () => null,
			rectsOf: () => [],
			keys: (depends, report) => {
				const answers = stage.editor.doc.blocks.map((block) => {
					try {
						return depends(block);
					} catch (cause) {
						report(cause);
						return '';
					}
				});
				return { version: () => 0, keys: () => answers };
			},
			settled: () => {},
			report: () => {}
		});
		walkBlocks(stage.document(), (node, path) => void source.decorationsOf(node, path));
	}
	// The paint source warns where it leaves a paint out; any warning while it was asked counts.
	const missed = warnings.slice(before);
	if (threw.length > 0) return failed(threw.join('; '));
	if (warningsFail && missed.length > 0) {
		return failed(missed.map(({ message }) => message).join('; '));
	}
	if (painted === 0) {
		return {
			status: 'not-applicable',
			detail: `painted nothing over ${samples.length} samples; an answer that waits (a dictionary, a fetch) paints on a later ask`
		};
	}
	return {
		status: 'passed',
		detail: `${painted} paint(s) over ${samples.length} samples land where they say`
	};
}

/** `body` highlighted in each language the highlighter lists. */
async function codeTokens(code: NonNullable<Contribution['code']>, body: string): Promise<Outcome> {
	const problems: string[] = [];
	let tokens = 0;
	for (const { name } of code.languages()) {
		let answer;
		try {
			answer = await code.highlight(body, name);
		} catch (error) {
			problems.push(`${name} threw: ${messageOf(error)}`);
			continue;
		}
		if (!answer) continue;
		tokens += answer.length;
		const { dropped } = nestedTokens(body.length, answer);
		if (dropped.length > 0) {
			const at = dropped.slice(0, 3).map((token) => `${token.from}..${token.to}`);
			problems.push(
				`${name}: ${dropped.length} token(s) out of order or crossing another (${at.join(', ')})`
			);
		}
	}
	if (problems.length > 0) return failed(problems.join('; '));
	return { status: 'passed', detail: `${tokens} token(s) nest inside the text` };
}
