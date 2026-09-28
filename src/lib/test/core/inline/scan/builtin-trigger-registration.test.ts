// Which characters a plugin may register as its inline trigger, over every ASCII character plus
// a few beyond it, and which registrations make the scanner's fast bail check the trigger.
import { describe, expect, it } from 'vitest';
import {
	hasScanProbeRungs,
	isReservedInlineTrigger,
	registerInlineSyntax,
	type InlineSyntaxRecognizer
} from '$lib/core/inline/scan/plugin-syntax';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';

const decline: InlineSyntaxRecognizer = () => null;

const CANDIDATES = [
	...Array.from({ length: 128 }, (_, code) => String.fromCharCode(code)),
	'é',
	'→',
	' '
];

const RESERVED = ['\n', '!', '&', '*', '<', '[', '\\', ']', '_', '`', '~'];

function outcome(register: () => void): string {
	try {
		register();
		return 'accepted';
	} catch (error) {
		return (error as Error).message;
	} finally {
		__resetSchemaRegistriesForTests();
	}
}

function charsWhere(test: (char: string) => boolean): string[] {
	return CANDIDATES.filter(test).sort();
}

describe('built-in inline triggers, as a plugin sees them', () => {
	it('reserves exactly the characters the scanner handles itself', () => {
		expect(charsWhere(isReservedInlineTrigger)).toEqual(RESERVED);
	});

	it('refuses a bare registration on exactly the reserved characters', () => {
		const refused = charsWhere(
			(char) => outcome(() => registerInlineSyntax(char, decline)) !== 'accepted'
		);
		expect(refused).toEqual(RESERVED);
	});

	it('accepts a prefix registration on every reserved character except "]"', () => {
		const refused = charsWhere(
			(char) =>
				outcome(() => registerInlineSyntax(char, decline, { prefix: `${char}{`, priority: 40 })) !==
				'accepted'
		);
		expect(refused).toEqual([']']);
	});

	it('turns the probe on for every unreserved trigger and `!`', () => {
		const unreserved = CANDIDATES.filter((char) => !isReservedInlineTrigger(char));
		expect(charsWhere(probesOnceRegistered)).toEqual([...unreserved, '!'].sort());
	});
});

function probesOnceRegistered(char: string): boolean {
	const options = isReservedInlineTrigger(char) ? { prefix: `${char}{`, priority: 40 } : undefined;
	try {
		registerInlineSyntax(char, decline, options);
		return hasScanProbeRungs();
	} catch {
		return false;
	} finally {
		__resetSchemaRegistriesForTests();
	}
}
