import fc from 'fast-check';

/**
 * The line ending as a document-level draw: LF, CRLF, or both (every other line CRLF), with the
 * last line's ending dropped half the time, so an edit meets a last block with none of its own.
 * Applied after the other generators compose, because they split on `'\n'` internally: rewriting
 * last is what keeps the bytes exact.
 */
export const withDrawnLineEnding = (source: fc.Arbitrary<string>): fc.Arbitrary<string> =>
	fc
		.tuple(source, fc.constantFrom('lf', 'crlf', 'mixed'), fc.boolean())
		.map(([bytes, ending, unterminated]) => {
			const written = inEnding(bytes, ending);
			return unterminated ? written.replace(/\r?\n$/, '') : written;
		});

function inEnding(bytes: string, ending: 'lf' | 'crlf' | 'mixed'): string {
	if (ending === 'lf') return bytes;
	if (ending === 'crlf') return bytes.replace(/\n/g, '\r\n');
	let line = 0;
	return bytes.replace(/\n/g, () => (line++ % 2 === 0 ? '\r\n' : '\n'));
}
