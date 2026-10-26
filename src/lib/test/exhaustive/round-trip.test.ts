// Every short string over the Markdown alphabet parses without throwing and serializes back to
// itself byte for byte, with the built-in syntax alone and with the bundled plugins' syntax.
import { it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import { enumerateStrings } from '../gfm-conformance/corpus';
import {
	ALPHABET_PLUGINS,
	BUILT_IN_ROUND_TRIP_LENGTH,
	EXHAUSTIVE_ALPHABET,
	ROUND_TRIP_LENGTH
} from './alphabet';
import { holdToKnownFailures } from './known-failures';

function roundTripFailures(maxLength: number): string[] {
	const failures: string[] = [];
	for (const source of enumerateStrings(EXHAUSTIVE_ALPHABET, 1, maxLength)) {
		let read: string;
		try {
			read = serialize(parse(source));
		} catch (error) {
			failures.push(`${JSON.stringify(source)} threw ${String(error)}`);
			continue;
		}
		if (read !== source)
			failures.push(`${JSON.stringify(source)} read back ${JSON.stringify(read)}`);
	}
	return failures;
}

it(`round-trips every string up to length ${BUILT_IN_ROUND_TRIP_LENGTH}, built-in syntax`, () => {
	const failures = roundTripFailures(BUILT_IN_ROUND_TRIP_LENGTH);
	holdToKnownFailures('round-trip built-in', failures, BUILT_IN_ROUND_TRIP_LENGTH);
}, 900_000);

it(`round-trips every string up to length ${ROUND_TRIP_LENGTH}, with the bundled plugins`, () => {
	installPlugins(ALPHABET_PLUGINS());
	const failures = roundTripFailures(ROUND_TRIP_LENGTH);
	holdToKnownFailures('round-trip plugins', failures, ROUND_TRIP_LENGTH);
}, 900_000);
