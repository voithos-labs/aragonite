import { describe, it, expect } from 'vitest';
import { Parser } from 'commonmark';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { metadataOf, type CstNode } from '$lib/core/nodes';
import {
	buildLinkReferenceMap,
	normalizeLinkLabel
} from '$lib/core/inline/link-reference-resolver';
import { loadDefinitionExamples } from './corpus';
import { editorOutline, referenceOutline } from './block-outline';
import baseline from './baseline.json';

// The spec's link reference definition examples, compared against commonmark.js as whole
// documents: which definitions exist, what each resolves to, and the blocks left around them.
// Miss-analysis: the corpus drew only the inline slice of the spec, and the inline differ skips
// any input that defines a reference, so no definition example ever ran.

interface Reading {
	definitions: string[];
	outline: string[];
}

// commonmark.js keys its definitions lowercased then uppercased; the editor lowercases.
function definitionLine(label: string, url: string, title: string | undefined): string {
	return `${label.toUpperCase()} -> ${JSON.stringify(url)} ${JSON.stringify(title ?? '')}`;
}

function editorReading(markdown: string): Reading {
	const doc = parse(markdown);
	const resolve = buildLinkReferenceMap(doc.children).resolve;
	const labels = new Set<string>();
	const visit = (nodes: CstNode[]): void => {
		for (const node of nodes) {
			if (node.kind === 'linkReferenceDefinition') {
				labels.add(normalizeLinkLabel(metadataOf(node, 'linkReferenceDefinition').label));
			}
			if (node.children) visit(node.children);
		}
	};
	visit(doc.children);
	const definitions = [...labels].map((label) => {
		const { url, title } = resolve(label)!;
		return definitionLine(label, url, title);
	});
	return { definitions: definitions.sort(), outline: editorOutline(markdown) };
}

function referenceReading(markdown: string): Reading {
	const parser = new Parser();
	parser.parse(markdown);
	const refmap = (
		parser as unknown as { refmap: Record<string, { destination: string; title: string }> }
	).refmap;
	const definitions = Object.entries(refmap).map(([label, ref]) =>
		definitionLine(label, ref.destination, ref.title)
	);
	return { definitions: definitions.sort(), outline: referenceOutline(markdown) };
}

// Typed by hand: an empty deviation list infers `never[]` from the JSON.
const deviationEntries: { example: number; note: string }[] = baseline.definitionDeviations;
const deviations = new Map(deviationEntries.map((entry) => [entry.example, entry.note]));

describe('link reference definition examples (§4.7) against commonmark.js', () => {
	for (const { example, markdown } of loadDefinitionExamples()) {
		const note = deviations.get(example);
		it(`example ${example}${note === undefined ? '' : ' diverges on purpose'}`, () => {
			const ours = editorReading(markdown);
			const theirs = referenceReading(markdown);
			if (note === undefined) expect(ours).toEqual(theirs);
			else
				expect(ours, `stale deviation, remove it from baseline.json: ${note}`).not.toEqual(theirs);
			expect(serialize(parse(markdown))).toBe(markdown);
		});
	}
});
