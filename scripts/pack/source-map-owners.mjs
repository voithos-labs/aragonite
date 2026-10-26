// Which source files own the bytes of a built page, read from its source maps: every mapped stretch
// of output is counted to the source its mapping names. Used by verify-dev-strip.mjs (G4.265).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// A minifier that merges declarations maps the shared `var ` to the first one's source, which may
// be a module whose own declaration it dropped, so a bare keyword proves nothing shipped.
const BARE_KEYWORD = /^(?:var|let|const)\s*$/;

/**
 * Output bytes per source, as the source path the map spells, over every `.js` file in `outDir`
 * that has a `.js.map` beside it.
 * @param {string} outDir
 * @returns {Map<string, number>}
 */
export function bytesBySource(outDir) {
	/** @type {Map<string, number>} */
	const owned = new Map();
	const maps = readdirSync(outDir, { recursive: true, withFileTypes: true }).filter(
		(entry) => entry.isFile() && entry.name.endsWith('.js.map')
	);
	for (const entry of maps) {
		const mapFile = path.join(entry.parentPath, entry.name);
		const map = JSON.parse(readFileSync(mapFile, 'utf8'));
		const lines = readFileSync(mapFile.slice(0, -'.map'.length), 'utf8').split('\n');
		let source = 0;
		map.mappings.split(';').forEach((/** @type {string} */ mappings, /** @type {number} */ at) => {
			const line = lines[at] ?? '';
			/** @type {[number, number | null][]} */
			const starts = [];
			let column = 0;
			for (const segment of mappings === '' ? [] : mappings.split(',')) {
				const fields = decodeSegment(segment);
				column += fields[0];
				if (fields.length >= 4) source += fields[1];
				starts.push([column, fields.length >= 4 ? source : null]);
			}
			starts.forEach(([start, owner], i) => {
				if (owner === null) return;
				const text = line.slice(start, starts[i + 1]?.[0] ?? line.length);
				if (BARE_KEYWORD.test(text)) return;
				const name = map.sources[owner];
				owned.set(name, (owned.get(name) ?? 0) + text.length);
			});
		});
	}
	return owned;
}

/** One mapping segment's fields, each relative to the segment before it. @param {string} segment */
function decodeSegment(segment) {
	/** @type {number[]} */
	const fields = [];
	let value = 0;
	let shift = 0;
	for (const char of segment) {
		const digit = BASE64.indexOf(char);
		value |= (digit & 31) << shift;
		shift += 5;
		if (digit & 32) continue;
		fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
		value = 0;
		shift = 0;
	}
	return fields;
}
