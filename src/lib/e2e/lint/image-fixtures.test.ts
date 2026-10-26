// Every PNG the e2e suite serves decodes: each chunk's checksum holds and the pixel data inflates to
// the size its header declares, since a corrupt one still reports a size until an engine fails it.
// `photos/` holds solid 8-bit RGB fills named `<role>-<width>x<height>.png`, each one IDAT deflating
// <height> rows of a 0 filter byte and <width> RGB triples (Node's `zlib.deflateSync`, level 9).
// Miss-analysis: nothing checked fixture bytes, and only Linux WebKit, under load, failed the image.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { collectFiles } from '../../test/invariants/lint/scan-source';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Table-free CRC-32, the checksum PNG puts after each chunk.
function crc32(bytes: Buffer): number {
	let crc = ~0;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
	}
	return ~crc >>> 0;
}

/** What is wrong with a PNG's bytes, or null for a non-interlaced one that decodes. */
function pngDefect(png: Buffer): string | null {
	if (!png.subarray(0, 8).equals(SIGNATURE)) return 'no PNG signature';
	let at = 8;
	let header: { width: number; height: number; bitsPerPixel: number; interlaced: boolean } | null =
		null;
	const data: Buffer[] = [];
	while (at < png.length) {
		const length = png.readUInt32BE(at);
		const typeAndData = png.subarray(at + 4, at + 8 + length);
		const type = typeAndData.subarray(0, 4).toString('latin1');
		if (at + 12 + length > png.length) return `${type} runs past the end of the file`;
		if (crc32(typeAndData) !== png.readUInt32BE(at + 8 + length)) return `${type} checksum`;
		const body = typeAndData.subarray(4);
		if (type === 'IHDR') {
			header = {
				width: body.readUInt32BE(0),
				height: body.readUInt32BE(4),
				bitsPerPixel: body[8] * CHANNELS[body[9]],
				interlaced: body[12] !== 0
			};
		}
		if (type === 'IDAT') data.push(body);
		at += 12 + length;
	}
	if (!header) return 'no IHDR';
	if (header.interlaced) return 'interlaced, which this check cannot size';
	let pixels: Buffer;
	try {
		pixels = inflateSync(Buffer.concat(data));
	} catch (e) {
		return `pixel data does not inflate: ${(e as Error).message}`;
	}
	const rowBytes = 1 + Math.ceil((header.width * header.bitsPerPixel) / 8);
	const expected = header.height * rowBytes;
	return pixels.length === expected
		? null
		: `${pixels.length} pixel bytes, header says ${expected}`;
}

describe('e2e image fixtures', () => {
	const pngs = collectFiles('static/test-fixtures', { extensions: ['.png'] });

	it('finds the fixtures', () => {
		expect(pngs.length).toBeGreaterThan(0);
	});

	it.each(pngs)('%s decodes', (relPath) => {
		expect(pngDefect(readFileSync(relPath))).toBeNull();
	});

	it('names a fixture whose pixel data is corrupt', () => {
		const valid = readFileSync(pngs[0]);
		const corrupt = Buffer.from(valid);
		corrupt[corrupt.indexOf('IDAT') + 6] ^= 0xff;
		expect(pngDefect(corrupt)).toBe('IDAT checksum');
	});
});
