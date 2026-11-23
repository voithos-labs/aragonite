/**
 * Paste rewrites through the one function every paste that lands as blocks calls
 * (`tree-operations/paste/paste-rewrites.ts`): `check`'s `rewriteLands` row over each type a plugin
 * rewrites, and the paste `rewritePaste` runs over a string.
 */

import { devWarn } from '@voithos-labs/aragonite/dev-checks';
import { splitLines } from '../core/lines';
import type { AnyBlockKind, CstNode } from '../core/nodes';
import { rewrittenPaste } from '../tree-operations/paste/paste-rewrites';
import type { ContributedRewrite } from '../schema/editor-contributions';
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
	rewrittenPaste(
		{ text, plain: false, asksRewrites: true },
		() => context.parse(text),
		activation,
		context.grammar
	);

// ── The row ──────────────────────────────────────────────────────────────────

/** `plugin`'s rewrites by the full name of the type each rewrites, in list order. */
export function rewriteSubjects(
	run: PluginCheckRun,
	plugin: string
): Map<string, ContributedRewrite[]> {
	const byType = new Map<string, ContributedRewrite[]>();
	for (const entry of run.contributions.rewrites) {
		if (entry.plugin !== plugin) continue;
		const from = entry.rewrite.from.name;
		byType.set(from, [...(byType.get(from) ?? []), entry]);
	}
	return byType;
}

/** `rewriteLands` over the rewrites of `from`: each of its samples pasted with a block below it, at
 *  the top and inside a container. */
export function rewriteOutcome(
	run: PluginCheckRun,
	mounted: Mount,
	from: string,
	entries: readonly ContributedRewrite[]
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
		contributions: { ...base.contributions!, rewrites: entries }
	};
	const [after, afterKind] =
		from === 'paragraph' ? ['# After the paste\n', 'heading'] : ['After the paste.\n', 'paragraph'];
	const wrap = from === 'blockquote' ? listItem : quoted;
	const problems: string[] = [];
	let landed = 0;
	for (const sample of samples) {
		for (const [clip, inside] of [
			[`${sample}\n${after}`, false],
			[wrap(`${sample}\n${after}`), true]
		] as const) {
			// The editor a rewrite is handed is the one `setup` met.
			mounted.over(clip);
			const out = pasted(context, activation, clip);
			if (out === clip) continue;
			landed++;
			const problem =
				landingProblem(context, out, afterKind, inside) ??
				growth(clip, out, pasted(context, activation, out));
			if (problem) problems.push(problem);
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

/** Why `out`, the answer pasted with a block below it, doesn't land as its own blocks: one pasted
 *  `inside` a container has to leave everything in it. */
function landingProblem(
	context: CheckContext,
	out: string,
	afterKind: string,
	inside: boolean
): string | null {
	const now = context.parse(out).children;
	if (inside && now.length !== 1) {
		return `${show(out)} leaves the container it was pasted in`;
	}
	const last = lastLeaf(now);
	if (last?.kind !== afterKind || !last.raw.includes('After the paste')) {
		return `${show(out)} swallows the block pasted after it`;
	}
	return null;
}

function growth(clip: string, out: string, again: string): string | null {
	if (again === out) return null;
	return `its answer to ${show(clip)} still reads as the type it rewrites, so each paste grows it: ${show(again)}`;
}

function lastLeaf(nodes: readonly CstNode[]): CstNode | undefined {
	let node = nodes[nodes.length - 1];
	while (node?.children?.length) node = node.children[node.children.length - 1];
	return node;
}

const linesOf = (text: string) => splitLines(text).map((line) => line.text);

const quoted = (text: string) =>
	linesOf(text)
		.map((line) => (line === '' ? '>' : `> ${line}`))
		.join('\n') + '\n';

const listItem = (text: string) =>
	linesOf(text)
		.map((line, i) => (i === 0 ? `- ${line}` : line === '' ? '' : `  ${line}`))
		.join('\n') + '\n';
