/**
 * `check`'s rows over a plugin's inline constructs: each `inline()`, `mark()` and marker pair it
 * lists, read from its samples the way the plugin's own editor reads them. A row is one check over
 * every sample, named after what the author listed; a marker pair is one subject, both its sides.
 * The checks a construct takes follow its shape: a widget's drawing, a built-in image or link
 * written in the plugin's syntax, a class, a mark, a pair.
 */

import type { AnyInlineKind, InlineNode } from '../core/nodes';
import { walkBlocks } from '../core/paths';
import { serialize } from '../core/serializer';
import { isBuiltinInlineKind } from '../core/nodes';
import { getInlineWidgetEditing, isInlineWidget } from '../core/inline/inline-widgets';
import { getInlineConstructPolicy, getInlineMarkPolicy } from '../schema/inline-construct-policy';
import type { InstalledInline } from '../schema/inline-type';
import type { Contribution } from '../schema/plugin-unit';
import type { Block } from '../schema/doc-view';
import type { InlineCheck } from './check-names';
import type { CheckContext, PluginCheckRun } from './check-context';
import { assert, assertIs, show } from './conformance-core';
import {
	assertLineRoundTrips,
	assertPolicyVocabulary,
	assertSelfDelimiting,
	imageFieldsOf
} from './inline-conformance';

/** One listed construct: an inline's or a mark's name, or a marker pair's, with what it reads as. */
export interface InlineSubject {
	readonly name: string;
	/** The construct, or a pair's open and close sides. */
	readonly parts: readonly InstalledInline[];
	readonly samples: readonly string[];
	readonly shape: 'widget' | 'class' | 'built-in' | 'mark' | 'pair';
}

export interface Outcome {
	status: 'passed' | 'failed' | 'not-applicable' | 'unchecked';
	detail: string;
}

/** The subjects a plugin's `inlines` lists, of those its install kept. */
export function inlineSubjects(
	listed: Contribution['inlines'],
	installed: ReadonlyMap<AnyInlineKind, InstalledInline>
): InlineSubject[] {
	return (listed ?? []).flatMap((entry): InlineSubject[] => {
		const sides = 'open' in entry ? [entry.open, entry.close] : [entry];
		const parts = sides.map((side) => installed.get(side.name as AnyInlineKind));
		if (parts.some((part) => part === undefined)) return [];
		const kept = parts as InstalledInline[];
		return [
			{ name: entry.name, parts: kept, samples: kept[0].samples, shape: shapeOf(entry, kept[0]) }
		];
	});
}

/** Every check `subject`'s shape takes, in order; a sample that fails stops the rest. */
export function inlineOutcomes(
	run: PluginCheckRun,
	subject: InlineSubject
): [InlineCheck, Outcome][] {
	const { context } = run;
	const out: [InlineCheck, Outcome][] = [['sample', sampleOutcome(subject)]];
	if (out[0][1].status === 'failed') return out;
	let claims: Claim[][] = [];
	out.push([
		'claims',
		settle(() => {
			claims = subject.samples.map((sample) => claimsOf(context, subject, sample));
			return checkClaims(subject, claims);
		})
	]);
	if (out[1][1].status === 'failed') return out;
	const all = claims.flat();
	const { shape } = subject;
	out.push(['roundTrip', settle(() => checkRoundTrip(context, subject, all))]);
	if (shape !== 'mark') out.push(['inlineDecline', settle(() => checkDecline(context, all))]);
	if (shape === 'widget') {
		out.push(['widget', settle(() => checkWidget(context, all))]);
		out.push(['editingPolicy', settle(() => checkEditingPolicy(context, subject.parts[0], all))]);
		out.push(['dependsContent', settle(() => checkDepends(run, subject))]);
	}
	if (shape === 'built-in') out.push(['inlineWriter', settle(() => checkWriter(all))]);
	if (shape !== 'pair') {
		out.push(['inlinePlace', settle(() => checkPlace(subject.parts[0], run.inlines))]);
	}
	if (shape === 'pair')
		out.push(['pairSides', settle(() => checkPairSides(context, subject, claims))]);
	return out;
}

/* -------------------------------------------------------------------------- */
/*                               Reading claims                               */
/* -------------------------------------------------------------------------- */

/** A claim of one part, in the block text it sits in as the inline scan reads it. */
interface Claim {
	readonly part: InstalledInline;
	readonly raw: string;
	readonly node: InlineNode;
}

function shapeOf(
	entry: NonNullable<Contribution['inlines']>[number],
	part: InstalledInline
): InlineSubject['shape'] {
	if ('open' in entry) return 'pair';
	if (part.mark) return 'mark';
	if (part.widget) return 'widget';
	return part.className !== null ? 'class' : 'built-in';
}

/** What every claim of `part` starts with: its prefix, or a mark's run. */
const prefixOf = (part: InstalledInline) => part.handler?.prefix ?? part.mark!.marker;

/** Whether `node` is a claim of `part`: its own kind, or a built-in image or link its prefix read. */
function owns(part: InstalledInline, node: InlineNode): boolean {
	if (node.kind === part.kind) return true;
	const borrowed = part.handler !== null && !part.widget && part.className === null && !part.marker;
	return (
		borrowed &&
		(node.kind === 'image' || node.kind === 'link') &&
		node.syntaxClaim?.prefix === part.handler!.prefix
	);
}

/** Every claim of `subject` in `sample`, read block by block in document order. */
function claimsOf(context: CheckContext, subject: InlineSubject, sample: string): Claim[] {
	const out: Claim[] = [];
	const visit = (nodes: readonly InlineNode[], raw: string) => {
		for (const node of nodes) {
			const part = subject.parts.find((candidate) => owns(candidate, node));
			if (part) out.push({ part, raw, node });
			else if (node.children) visit(node.children, raw);
		}
	};
	walkBlocks(context.parse(sample), (node) => visit(context.inline(node), node.raw));
	return out;
}

/** The claim's bytes. */
const bytesOf = ({ raw, node }: Claim) => raw.slice(node.start, node.end);

/** The block text a claim sits in, without its line ending. */
const lineOf = ({ raw }: Claim) => raw.replace(/\r?\n$/, '');

function settle(check: () => Outcome | string): Outcome {
	try {
		const answer = check();
		return typeof answer === 'string' ? { status: 'passed', detail: answer } : answer;
	} catch (error) {
		return { status: 'failed', detail: (error as Error).message };
	}
}

const notApplicable = (detail: string): Outcome => ({ status: 'not-applicable', detail });

/* -------------------------------------------------------------------------- */
/*                                 The checks                                 */
/* -------------------------------------------------------------------------- */

function sampleOutcome({ samples }: InlineSubject): Outcome {
	return samples.length === 0
		? { status: 'failed', detail: 'lists no sample: give `sample` the Markdown the checks drive' }
		: { status: 'passed', detail: `${samples.length} sample(s)` };
}

function checkClaims(subject: InlineSubject, claims: readonly Claim[][]): string {
	const problems: string[] = [];
	subject.samples.forEach((sample, at) => {
		for (const part of subject.parts) {
			if (!claims[at].some((claim) => claim.part === part)) {
				problems.push(`${show(sample)} holds no claim of "${part.kind}"`);
			}
		}
		for (const claim of claims[at]) {
			if (!claim.raw.startsWith(prefixOf(claim.part), claim.node.start)) {
				problems.push(
					`the claim ${show(bytesOf(claim))} doesn't start with ${show(prefixOf(claim.part))}`
				);
			}
		}
	});
	assert(problems.length === 0, problems.join('; '));
	const count = claims.flat().length;
	return `${count} claim(s) across ${subject.samples.length} sample(s)`;
}

function checkRoundTrip(
	context: CheckContext,
	subject: InlineSubject,
	claims: readonly Claim[]
): string {
	for (const sample of subject.samples) {
		const text = sample.endsWith('\n') ? sample : `${sample}\n`;
		assertIs(
			serialize(context.parse(text)),
			text,
			`the sample ${show(text)} reads back to its bytes`
		);
	}
	let sources = 0;
	// A line once per part on it, so a pair's two sides on one line each get their own prefix cut.
	const lines = new Map(claims.map((claim) => [`${claim.part.kind}\n${lineOf(claim)}`, claim]));
	for (const claim of lines.values()) {
		const line = lineOf(claim);
		if (!line.includes('\n'))
			sources += assertLineRoundTrips(context, line, claim.part.trigger, prefixOf(claim.part));
	}
	return `${subject.samples.length} sample(s) and ${sources} line(s) around a claim read back to their bytes`;
}

/** Where a link's or an image's text ends: its closing bracket. */
const closingBracket = (node: InlineNode) =>
	node.children?.length ? node.children.at(-1)!.end : node.start + (node.kind === 'image' ? 2 : 1);

function* walk(nodes: readonly InlineNode[]): Generator<InlineNode> {
	for (const node of nodes) {
		yield node;
		if (node.children) yield* walk(node.children);
	}
}

/** Each claim at a bracket, with a destination written after it: where the editor's own reading
 *  closes a link or an image inside the claim, the claim gives way and the bytes read back. */
function checkDecline(context: CheckContext, claims: readonly Claim[]): Outcome | string {
	const bracketed = claims.filter((claim) => /^!?\[/.test(prefixOf(claim.part)));
	if (bracketed.length === 0)
		return notApplicable('no claim of it starts at a bracket the editor reads');
	let overlaps = 0;
	for (const claim of bracketed) {
		const { node } = claim;
		const line = lineOf(claim);
		const text = `${line.slice(0, node.end)}(https://example.com)${line.slice(node.end)}`;
		const own = [...walk(context.builtIns().parseInline(text, 0, text.length))].find(
			(n) =>
				(n.kind === 'link' || n.kind === 'image') &&
				n.start === node.start &&
				closingBracket(n) < node.end
		);
		if (!own) continue;
		overlaps++;
		const kept = [...walk(context.parseInline(text, 0, text.length))].find(
			(n) => n.start === node.start && owns(claim.part, n)
		);
		assert(
			!kept,
			`${show(text)} still reads as "${claim.part.kind}", though the editor's own ${own.kind} closes inside the claim`
		);
		const withEnding = `${text}\n`;
		assertIs(
			serialize(context.parse(withEnding)),
			withEnding,
			`${show(withEnding)} reads back to its bytes`
		);
	}
	if (overlaps === 0) {
		return notApplicable(
			"no claim of it reads as the editor's link or image with a destination after it"
		);
	}
	return `${overlaps} claim(s) give way to the editor's own link or image`;
}

function checkWidget(context: CheckContext, claims: readonly Claim[]): string {
	for (const claim of claims) {
		const { raw, node, part } = claim;
		assert(
			isInlineWidget(node, raw, context.grammar),
			`the claim ${show(bytesOf(claim))} is drawn as a widget`
		);
		assertSelfDelimiting(context, raw, node, part.kind);
	}
	return `${claims.length} claim(s) are one widget each, over bytes that read alone`;
}

function checkEditingPolicy(
	context: CheckContext,
	part: InstalledInline,
	claims: readonly Claim[]
): string {
	const policy = getInlineWidgetEditing(part.kind, context.grammar);
	assert(policy !== undefined, `"${part.kind}" has no editing policy the editor reads`);
	assertPolicyVocabulary(policy, part.kind);
	for (const claim of claims) {
		const source = bytesOf(claim);
		const span = policy.revealContentSpan?.(source);
		if (span) {
			assert(
				0 <= span.start && span.start <= span.end && span.end <= source.length,
				`inner(${show(source)}) answers ${show(span)}, which isn't inside its bytes`
			);
		}
		if (policy.deleteGranularity !== 'atomic') continue;
		const line = lineOf(claim);
		const excised = `${line.slice(0, claim.node.start)}${line.slice(claim.node.end)}\n`;
		assertIs(
			serialize(context.parse(excised)),
			excised,
			`deleting the claim ${show(source)} whole leaves bytes that read back`
		);
	}
	return policy.deleteGranularity === 'atomic'
		? 'its fields, and deleting each claim whole, read back'
		: 'its fields read as the editor reads them';
}

function checkWriter(claims: readonly Claim[]): Outcome | string {
	let written = 0;
	for (const claim of claims) {
		const { node } = claim;
		const source = bytesOf(claim);
		if (node.kind === 'image' && node.syntaxClaim?.rewriteImage) {
			assertIs(
				node.syntaxClaim.rewriteImage(source, imageFieldsOf(node)),
				source,
				`write gives the image ${show(source)} back from what was read out of it`
			);
			written++;
		} else if (node.kind === 'link' && node.syntaxClaim?.rewriteLink) {
			const text = node.children?.[0]?.text ?? '';
			const fields = {
				text,
				url: node.url ?? '',
				...(node.title !== undefined && { title: node.title })
			};
			assertIs(
				node.syntaxClaim.rewriteLink(fields),
				source,
				`write gives the link ${show(source)} back from what was read out of it`
			);
			written++;
		}
	}
	if (written === 0) return notApplicable('lists no write, so the editor refuses every edit of it');
	return `write gives back ${written} claim(s)`;
}

/** `after` orders a construct among those on its character, or a mark among marks; a value names
 *  only one made before it, so two can't follow each other. */
function checkPlace(
	part: InstalledInline,
	installed: ReadonlyMap<AnyInlineKind, InstalledInline>
): Outcome | string {
	if (part.after.length === 0) return notApplicable('names no construct to follow');
	const plugin = part.kind.slice(0, part.kind.indexOf('/'));
	const problems: string[] = [];
	for (const { name } of part.after) {
		const other = installed.get(name as AnyInlineKind);
		if (part.mark) {
			if (
				getInlineMarkPolicy(name as AnyInlineKind)?.nestingRank === undefined &&
				ownedBy(name, plugin)
			) {
				problems.push(`names "${name}", which is no mark, so it nests where marks nest by default`);
			}
		} else if (isBuiltinInlineKind(name as AnyInlineKind)) {
			problems.push(`names the editor's own "${name}", which every construct is tried before`);
		} else if (other && other.trigger !== part.trigger) {
			problems.push(`names "${name}", which starts on another character, so it orders nothing`);
		}
	}
	assert(problems.length === 0, problems.join('; '));
	return `follows ${part.after.map(({ name }) => `"${name}"`).join(', ')}`;
}

/** Whether `name` is the editor's own or `plugin`'s: one another plugin made can't be judged here. */
const ownedBy = (name: string, plugin: string) =>
	isBuiltinInlineKind(name as AnyInlineKind) || name.startsWith(`${plugin}/`);

/** `depends` asked twice of each block, and again with a paragraph put above the sample. */
function checkDepends(run: PluginCheckRun, subject: InlineSubject): Outcome | string {
	const depends = subject.parts[0].widget?.own?.depends;
	if (!depends) return notApplicable('lists no depends');
	const answers = (blocks: readonly Block[]) => blocks.map((block) => depends(block));
	let blocks = 0;
	for (const sample of subject.samples) {
		const placed = run.editor(sample).doc.blocks;
		const first = answers(placed);
		assertIs(
			JSON.stringify(answers(placed)),
			JSON.stringify(first),
			`depends answers the blocks of ${show(sample)} alike when asked twice`
		);
		const moved = answers(run.editor(`above\n\n${sample}`).doc.blocks.slice(1));
		assertIs(
			JSON.stringify(moved),
			JSON.stringify(first),
			`depends answers the blocks of ${show(sample)} alike with a paragraph put above them: it reads ` +
				'where a block stands, so every key above it draws the widget again'
		);
		blocks += placed.length;
	}
	return `answers ${blocks} block(s) from what they hold`;
}

/** Each side read alone in a block, and the sides of one sample keyed alike. */
function checkPairSides(
	context: CheckContext,
	subject: InlineSubject,
	claims: readonly Claim[][]
): string {
	const [open, close] = subject.parts;
	const problems: string[] = [];
	const alone = new Set(claims.flat().map((claim) => `${claim.part.kind}\u0000${bytesOf(claim)}`));
	for (const entry of alone) {
		const [kind, bytes] = entry.split('\u0000');
		const part = kind === open.kind ? open : close;
		const read = claimsOf(context, { ...subject, parts: [part] }, bytes);
		if (!read.some((claim) => claim.node.start === 0 && bytesOf(claim) === bytes)) {
			problems.push(
				`${show(bytes)} alone in a block reads as no ${part === open ? 'open' : 'close'} side, so a pair across two blocks leaves it unread`
			);
		}
	}
	const key = getInlineConstructPolicy(open.kind)?.pair?.key;
	if (key) {
		subject.samples.forEach((sample, at) => {
			const keys = (part: InstalledInline) =>
				claims[at]
					.filter((claim) => claim.part === part)
					.map((claim) => key(claim.node.data))
					.sort();
			const [opens, closes] = [keys(open), keys(close)];
			if (JSON.stringify(opens) !== JSON.stringify(closes)) {
				problems.push(
					`in ${show(sample)} the open sides read the keys ${JSON.stringify(opens)} and the close sides ${JSON.stringify(closes)}: \`key\` reads one id from both sides of a pair`
				);
			}
		});
	}
	assert(problems.length === 0, problems.join('; '));
	return key ? 'each side reads alone, and both sides read one key' : 'each side reads alone';
}
