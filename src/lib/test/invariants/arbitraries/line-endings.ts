import fc from 'fast-check';

/**
 * The line ending as a document-level draw. "A CRLF document containing a structured block" is
 * otherwise unreachable by every lane at once — the hole two shipped byte-corruption defects lived
 * in. Applied after the arms compose, since they split on `'\n'` internally: rewriting last is what
 * keeps the result byte-exact.
 */
export const withDrawnLineEnding = (source: fc.Arbitrary<string>): fc.Arbitrary<string> =>
	fc
		.tuple(source, fc.boolean())
		.map(([bytes, crlf]) => (crlf ? bytes.replace(/\n/g, '\r\n') : bytes));
