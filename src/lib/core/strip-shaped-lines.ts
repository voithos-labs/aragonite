/** An opener's lines read the way the container writer writes them, for a plugin that parses its own
 *  shaped container until the editor parses one itself. */

import type { ParsedLine } from './lines';
import { codecFromShape, FIRST_LINE, INNER_LINE, type StripShape } from './strip-lines';

/** The body text `lines` hold as a container of `shape` reads them, a line it can't read kept whole. */
export function stripShapedLines<D extends object>(
	shape: StripShape<D>,
	data: D,
	lines: ParsedLine[]
): string {
	const codec = codecFromShape(shape, data);
	let out = '';
	for (let i = 0; i < lines.length; i++) {
		const place = i === 0 ? FIRST_LINE : INNER_LINE;
		out += (codec.read(lines[i].text, place)?.text ?? lines[i].text) + lines[i].lineEnding;
	}
	return out;
}
