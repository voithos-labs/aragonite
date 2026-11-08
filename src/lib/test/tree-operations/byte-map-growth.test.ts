// A container's byte map (where a caret lands after a splice, where a copy's ends sit) costs in
// proportion to the container, timed at N and 4N bytes of a quote and a table.
// Miss-analysis: the byte map's cost rows priced a list, which it reads through its child spans and
// never pairs line by line, so no row timed the line pairing a quote or a table takes.
import { describe, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { documentByteMap } from '#lib/tree-operations/container-offsets.js';
import { expectBoundedGrowth, measureScanGrowth, type ScanSource } from '../harness/scan-growth';

/** Each run builds the map afresh twice, so its pairing outweighs the parse in the timing. */
function mapTwice(source: string): void {
	const doc = parse(source);
	const middle = Math.floor(source.length / 2);
	documentByteMap(doc).leafAt(middle);
	const container = doc.children[0];
	const child = Math.floor(container.children!.length / 2);
	documentByteMap(doc).byteOf(container.kind === 'table' ? [0, child, 0] : [0, child], 0);
}

const SHAPES: [string, ScanSource][] = [
	['a quote', '> one two three four\n>\n'],
	[
		'a table',
		(bytes, salt) =>
			'| a | b |\n| --- | --- |\n' +
			'| one | two |\n'.repeat(Math.ceil(bytes / 14)) +
			`| ${salt}x | y |\n`
	]
];

describe("a container's byte map grows with the container", () => {
	it.each(SHAPES)(
		'in %s',
		(_, source) => {
			expectBoundedGrowth(measureScanGrowth(mapTwice, source, [64, 256]));
		},
		300_000
	);
});
