import fc from 'fast-check';

/**
 * The line ending as a document-level draw. Without it, no single generator produces a CRLF
 * document that also contains a structured block. It is applied after the other generators
 * compose, because they split on `'\n'` internally: rewriting last is what keeps the bytes exact.
 */
export const withDrawnLineEnding = (source: fc.Arbitrary<string>): fc.Arbitrary<string> =>
	fc
		.tuple(source, fc.boolean())
		.map(([bytes, crlf]) => (crlf ? bytes.replace(/\n/g, '\r\n') : bytes));
