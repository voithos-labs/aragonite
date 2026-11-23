/**
 * Paste rewrites through the one function every paste that lands as blocks calls
 * (`selection/cross-block/range-paste.ts :: rewrittenClip`): `check`'s `rewriteLands` row over each
 * whole-paste rewrite and each type a plugin rewrites, and the paste `rewritePaste` runs over a string.
 */

import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import { isBlankText, splitLines, trimTrailingLineEnding } from '../core/lines';
import type { AnyBlockKind, CstNode } from '../core/nodes';
import { rewrittenClip } from '../selection/cross-block/range-paste';
import type {
	ContributedBlockRewrite,
	ContributedPasteRewrite
} from '../schema/editor-contributions';
import type { PluginActivation } from '../schema/plugin-activation';
import type { PluginError } from '../schema/plugin-unit';
import type { CheckContext, PluginCheckRun } from './check-context';
import type { Mount } from './command-check';
import type { Outcome } from './inline-check';
import { show } from './conformance-core';

// ── The paste ────────────────────────────────────────────────────────────────

// With no editor to hear it, a plugin left out or a rewrite that threw says so in a dev build.
export function heardOutside(error: PluginError): void {
	devWarn('plugin-error', `plugin '${error.plugin}' failed (${error.doing})`, error.cause);
}

/** `text` pasted from outside the editor, read as `context` reads it. */
export const pasted = (context: CheckContext, activation: PluginActivation, text: string) =>
	rewrittenClip(context.reading(), activation, { text, plain: false, asksRewrites: true }, () =>
		context.parse(text)
	);

// ── The row ──────────────────────────────────────────────────────────────────

/** `rewriteLands` over a whole-paste rewrite: its sample pasted at the top and inside a quote is
 *  answered, and its answer pasted again comes back as it is. */
export function pasteRewriteOutcome(
	run: PluginCheckRun,
	mounted: Mount,
	entry: ContributedPasteRewrite
): Outcome {
	const { context } = run;
	const { sample } = entry.rewrite;
	if (typeof sample !== 'string' || sample === '') {
		return { status: 'failed', detail: 'lists no sample: give `sample` a paste it rewrites' };
	}
	// It alone runs, so another rewrite's answer can't stand in for its own.
	const base = context.grammar.activation;
	const activation: PluginActivation = {
		isActive: (name) => base.isActive(name),
		contributions: { ...base.contributions!, pasteRewrites: [entry], blockRewrites: [] }
	};
	const problems: string[] = [];
	for (const [where, doc] of PLACES) {
		// The editor a rewrite is handed holds the document the paste lands in.
		mounted.over(doc);
		const out = pasted(context, activation, sample);
		if (out === sample) problems.push(`it keeps its own sample ${show(sample)} pasted ${where}`);
		else {
			const again = pasted(context, activation, out);
			if (again !== out) {
				problems.push(
					`its answer pasted ${where} is rewritten again: ${show(out)} becomes ${show(again)}`
				);
			}
		}
	}
	if (problems.length > 0) return { status: 'failed', detail: problems.join('; ') };
	return {
		status: 'passed',
		detail: 'it answers its sample at the top and inside a quote, and keeps its answer'
	};
}

/** `plugin`'s whole-paste rewrites, in list order. */
export const pasteRewritesOf = (run: PluginCheckRun, plugin: string) =>
	run.contributions.pasteRewrites.filter((entry) => entry.plugin === plugin);

/** `plugin`'s block rewrites by the full name of the type each rewrites, in list order. */
export function rewriteSubjects(
	run: PluginCheckRun,
	plugin: string
): Map<string, ContributedBlockRewrite[]> {
	const byType = new Map<string, ContributedBlockRewrite[]>();
	for (const entry of run.contributions.blockRewrites) {
		if (entry.plugin !== plugin) continue;
		const from = entry.rewrite.from.name;
		byType.set(from, [...(byType.get(from) ?? []), entry]);
	}
	return byType;
}

/** `rewriteLands` over the rewrites of `from`: each of its samples pasted alone, with a block flush
 *  below it, and with one flush above it too, at the top and inside a container. */
export function rewriteOutcome(
	run: PluginCheckRun,
	mounted: Mount,
	from: string,
	entries: readonly ContributedBlockRewrite[]
): Outcome {
	const { context } = run;
	const samples = context.grammar.tryDescriptor(from as AnyBlockKind)?.samples ?? [];
	if (samples.length === 0) {
		return { status: 'not-applicable', detail: `"${from}" has no sample to paste` };
	}
	// Only these rewrites run, so a block below that another of the plugin's rewrites takes stays.
	const base = context.grammar.activation;
	const activation: PluginActivation = {
		isActive: (name) => base.isActive(name),
		contributions: { ...base.contributions!, pasteRewrites: [], blockRewrites: entries }
	};
	// Neighbours a sample of `from` can't read into, so only its answer can.
	const [above, below] =
		from === 'paragraph'
			? ['# Before the paste\n', '# After the paste\n']
			: ['Before the paste.\n', 'After the paste.\n'];
	const wrap = from === 'blockquote' ? listItem : quoted;
	const problems: string[] = [];
	let landed = 0;
	for (const sample of samples) {
		for (const [before, after] of [
			['', ''],
			['', below],
			[above, below]
		]) {
			for (const inside of [false, true]) {
				const flush = `${before}${sample}\n${after}`;
				const clip = inside ? wrap(flush) : flush;
				// The editor a rewrite is handed is the one `setup` met.
				mounted.over(clip);
				const out = pasted(context, activation, clip);
				if (out === clip) continue;
				landed++;
				// An answer that leaves nothing pastes nothing: the editor writes nothing for it.
				if (isBlankText(out)) continue;
				const problem =
					landingProblem(context, out, before, after, inside) ??
					growth(clip, out, pasted(context, activation, out));
				if (problem) problems.push(problem);
			}
		}
	}
	if (problems.length > 0) return { status: 'failed', detail: problems.join('; ') };
	if (landed === 0) {
		return { status: 'not-applicable', detail: `it keeps every sample of "${from}"` };
	}
	return {
		status: 'passed',
		detail: `${landed} answer(s) land as their own blocks and stay put on the next paste`
	};
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** Why `out`, the answer pasted between `before` and `after`, doesn't land as its own blocks: each
 *  neighbour keeps its own bytes, and one pasted `inside` a container leaves everything in it. */
function landingProblem(
	context: CheckContext,
	out: string,
	before: string,
	after: string,
	inside: boolean
): string | null {
	const now = context.parse(out).children;
	if (inside && now.length !== 1) {
		return `${show(out)} leaves the container it was pasted in`;
	}
	const kept = (leaf: CstNode | undefined, bytes: string) =>
		!!leaf && trimTrailingLineEnding(leaf.raw) === trimTrailingLineEnding(bytes);
	if (after && !kept(edgeLeaf(now, -1), after)) {
		return `${show(out)} swallows the block pasted after it`;
	}
	if (before && !kept(edgeLeaf(now, 0), before)) {
		return `${show(out)} joins the block pasted above it`;
	}
	return null;
}

function growth(clip: string, out: string, again: string): string | null {
	if (again === out) return null;
	return `its answer to ${show(clip)} still reads as the type it rewrites, so each paste grows it: ${show(again)}`;
}

/** The first (`0`) or last (`-1`) block of `nodes` that holds no other block. */
function edgeLeaf(nodes: readonly CstNode[], edge: 0 | -1): CstNode | undefined {
	let node = nodes.at(edge);
	while (node?.children?.length) node = node.children.at(edge);
	return node;
}

// The places a whole-paste rewrite's sample is pasted, the caret at each one's text end.
const PLACES = [
	['at the top', 'Before the paste.\n'],
	['inside a quote', '> Before the paste.\n']
] as const;

const linesOf = (text: string) => splitLines(text).map((line) => line.text);

const quoted = (text: string) =>
	linesOf(text)
		.map((line) => (line === '' ? '>' : `> ${line}`))
		.join('\n') + '\n';

const listItem = (text: string) =>
	linesOf(text)
		.map((line, i) => (i === 0 ? `- ${line}` : line === '' ? '' : `  ${line}`))
		.join('\n') + '\n';
