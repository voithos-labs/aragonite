/**
 * The container checks for a type `container()` made, from one of its samples: the fixtures the
 * kit's container cells read, derived rather than written by hand, and `containerDeclared`, which
 * holds the line shape to itself (what it writes reads back).
 */

import type { AnyBlockKind, CstNode } from '../core/nodes';
import { getPluginMetadata } from '../core/nodes';
import { documentLineEnding, splitLines } from '../core/lines';
import type { HeadedLines, IndentedLines, LineShape } from '../core/strip-lines';
import { writeContainerRaw } from '../schema/container-writer';
import type { CheckContext } from './check-context';
import {
	assert,
	assertRebuildKeepsParsedBytes,
	show,
	subjectNode,
	type KitCell
} from './conformance-core';
import {
	assertHintedRebuildMatchesFull,
	assertUntouchedLinesKept,
	type BuiltinContainerProfile,
	type ContainerCellContext
} from './container-conformance';

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                  */
/* -------------------------------------------------------------------------- */

const ASSERT = { mode: 'assert' } as const;
// The kit asks for these two, and a check over a maker's container never runs them.
const NOT_RUN = { mode: 'exempt', reason: 'not a check over a container a maker made' } as const;

/** The container cells' fixtures from `sample`: the type grown to two children through its own
 *  writer, then quoted, so it sits one level down with a leaf under it. */
export function derivedProfile(
	context: CheckContext,
	kind: AnyBlockKind,
	sample: string
): BuiltinContainerProfile {
	const grown = grownSample(context, kind, sample);
	const last =
		subjectNode(context.parse(grown), kind, [0], 'the grown sample').children!.length - 1;
	const quoted = splitLines(grown)
		.map((line) => (line.text === '' ? '>' : `> ${line.text}`) + line.lineEnding)
		.join('');
	const leafPath = [0, 0, last];
	let leaf: CstNode = subjectNode(context.parse(quoted), kind, [0, 0], 'the quoted sample');
	leaf = leaf.children![last];
	while (leaf.children?.length) {
		leafPath.push(0);
		leaf = leaf.children[0];
	}
	return {
		deepNesting: { source: quoted, leafPath },
		localIndexFixture: { source: quoted, containerChain: [0, 0], targetChild: last },
		focusSource: grown,
		localIndex: ASSERT,
		ancestry: ASSERT,
		focusBubble: ASSERT,
		multiScope: NOT_RUN,
		terminatorCollision: NOT_RUN
	};
}

/** The type's bytes from `sample`, with a paragraph written in for each child short of two. */
function grownSample(context: CheckContext, kind: AnyBlockKind, sample: string): string {
	const doc = context.parse(sample);
	const node = subjectNode(doc, kind, [0], 'the sample');
	const children = (node.children ??= []);
	if (children.length >= 2) return node.raw;
	const ending = documentLineEnding(doc);
	while (children.length < 2) {
		const leadingTrivia = children.length > 0 ? ending : '';
		children.push({ kind: 'paragraph', leadingTrivia, raw: `probe ${children.length}${ending}` });
	}
	writeContainerRaw(node, context.grammar);
	const grown = context.parse(node.raw).children[0];
	assert(
		grown?.kind === kind && grown.children?.length === 2,
		`"${kind}"'s own lines write the sample grown to two children as ${show(node.raw)}, which ` +
			`reads back as ${grown?.kind === kind ? `${grown.children?.length ?? 0}` : `a "${grown?.kind}"`}`
	);
	return node.raw;
}

/* -------------------------------------------------------------------------- */
/*                        The shape agrees with itself                        */
/* -------------------------------------------------------------------------- */

/** `containerDeclared`: a head line or first marker written from data reads back as it, and the
 *  writer keeps the grown sample's bytes, rewriting one child's lines alone however it's asked. */
export const CONTAINER_DECLARED: KitCell<'containerDeclared', ContainerCellContext> = {
	cell: 'containerDeclared',
	run: ({ context, kind, profile, sample }) => {
		const descriptor = context.descriptor(kind);
		const lines = descriptor.lines;
		assert(lines !== undefined, `"${kind}" writes no line shape`);
		const node = subjectNode(context.parse(sample ?? ''), kind, [0], 'the sample');
		shapeReadsItsWriting(kind, lines, getPluginMetadata(node));
		// A derived profile focuses on the grown sample.
		const source = profile.focusSource!;
		const grown = subjectNode(context.parse(source), kind, [0], 'the grown sample');
		assertRebuildKeepsParsedBytes(context, grown, kind);
		assertUntouchedLinesKept(context, kind, descriptor, source);
		const again = subjectNode(context.parse(source), kind, [0], 'the grown sample');
		assertHintedRebuildMatchesFull(context, kind, descriptor, again);
		return `the ${lines.shape} shape reads what it writes, and keeps the lines no edit changed`;
	}
};

// A marked shape's `reads` against its own markers is the install's to refuse (G1.191).
function shapeReadsItsWriting(kind: AnyBlockKind, lines: LineShape<object>, data: unknown): void {
	if (lines.shape === 'indented') indentedReadsBack(kind, lines, data as object);
	else if (lines.shape === 'marked' && 'head' in lines) {
		headReadsBack(kind, lines as HeadedLines<object>, data as object);
	}
}

/** A head line written from the data the sample was read as reads back as that data. */
function headReadsBack(kind: AnyBlockKind, lines: HeadedLines<object>, data: object): void {
	const written = lines.head.write(data);
	const again = lines.head.match.exec(written);
	assert(
		again?.index === 0 && again[0] === written && same(lines.head.data(again), data),
		`"${kind}"'s head.write gives ${show(written)} for ${show(JSON.stringify(data))}, which ` +
			`head.match doesn't read back as that data`
	);
}

/** The first line's marker written from the data reads back through `open` as that data, and the
 *  lines after it indent with spaces only. */
function indentedReadsBack(kind: AnyBlockKind, lines: IndentedLines<object>, data: object): void {
	const marker = lines.first(data);
	const read = lines.open.exec(`${marker}probe`);
	assert(
		read?.index === 0 && read[0].length <= marker.length && same(lines.data(read), data),
		`"${kind}"'s lines.first gives ${show(marker)} for ${show(JSON.stringify(data))}, which ` +
			`lines.open doesn't read back as that data`
	);
	const rest = lines.rest(data);
	assert(/^ *$/.test(rest), `"${kind}"'s lines.rest gives ${show(rest)}, which isn't spaces only`);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
