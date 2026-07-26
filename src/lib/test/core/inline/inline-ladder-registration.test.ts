import { afterEach, describe, expect, it } from 'vitest';
import {
	INLINE_PRIORITIES,
	__resetInlineSyntaxForTests,
	getInlineRungs,
	registerInlineSyntax,
	type InlineSyntaxRecognizer
} from '../../../core/inline/scan/plugin-syntax';

afterEach(() => __resetInlineSyntaxForTests());

// Registration validation runs before any recognizer is consulted, so a bare
// decliner stands in for every rung under test.
const decline: InlineSyntaxRecognizer = () => null;

describe('inline ladder — registration rules', () => {
	it('exposes the priority ladder as a published const', () => {
		expect(INLINE_PRIORITIES).toEqual({ prefixOverride: 40, builtin: 50, plugin: 100 });
	});

	it('rule 1 — rejects a multi-character trigger', () => {
		expect(() => registerInlineSyntax('$$', decline)).toThrow(/single character/);
	});

	it.each([
		['prefix that does not start with the trigger', '[', 'x^'],
		['prefix shorter than two characters', '[', '['],
		['bare-length prefix on an unreserved trigger', ':', ':']
	])('rule 1 — rejects a %s', (_name, trigger, prefix) => {
		expect(() => registerInlineSyntax(trigger, decline, { prefix, priority: 40 })).toThrow(
			/must begin with the trigger/
		);
	});

	it('rule 2 — bare reserved registration keeps the built-in-scanner message', () => {
		expect(() => registerInlineSyntax('[', decline)).toThrow(/claimed by the built-in scanner/);
		expect(getInlineRungs('[')).toHaveLength(0);
	});

	it.each([INLINE_PRIORITIES.builtin, INLINE_PRIORITIES.plugin])(
		'rule 2 — reserved prefix at priority %i (≥ builtin) is rejected',
		(priority) => {
			expect(() => registerInlineSyntax('[', decline, { prefix: '[^', priority })).toThrow(
				/priority below the built-in boundary/
			);
		}
	);

	it('rule 2 — reserved prefix defaulting its priority is rejected (default is the plugin rung)', () => {
		expect(() => registerInlineSyntax('[', decline, { prefix: '[^' })).toThrow(
			/priority below the built-in boundary/
		);
	});

	it('rule 2 — a prefix rung on scan-invisible reserved trigger "]" is rejected', () => {
		expect(() => registerInlineSyntax(']', decline, { prefix: ']]', priority: 40 })).toThrow(
			/scan-visible/
		);
	});

	it('rule 2 — a prefix rung on a scan-visible reserved trigger is accepted', () => {
		expect(() => registerInlineSyntax('[', decline, { prefix: '[^', priority: 40 })).not.toThrow();
	});

	// `!` is scan-probed rather than scan-visible: absent from SPECIAL_CHARS, made
	// visible to the fast bail by the registration itself. It registers like any
	// other reserved trigger — prefix required, priority below the built-in anchor.
	it('rule 2 — a prefix rung on the scan-probed reserved trigger "!" is accepted', () => {
		expect(() => registerInlineSyntax('!', decline, { prefix: '![[', priority: 40 })).not.toThrow();
		expect(getInlineRungs('!')).toHaveLength(1);
	});

	it.each([
		['bare', undefined, /claimed by the built-in scanner/],
		['at the built-in priority', INLINE_PRIORITIES.builtin, /priority below the built-in boundary/]
	])('rule 2 — a %s registration on "!" is still rejected', (_name, priority, message) => {
		const options = priority === undefined ? undefined : { prefix: '![[', priority };
		expect(() => registerInlineSyntax('!', decline, options)).toThrow(message);
		expect(getInlineRungs('!')).toHaveLength(0);
	});

	it('rule 3 — an unreserved trigger takes any priority; bare defaults to the plugin rung', () => {
		registerInlineSyntax(':', decline);
		expect(getInlineRungs(':')[0].priority).toBe(INLINE_PRIORITIES.plugin);
		registerInlineSyntax('$', decline, { priority: INLINE_PRIORITIES.prefixOverride });
		expect(getInlineRungs('$')[0].priority).toBe(INLINE_PRIORITIES.prefixOverride);
	});

	it('rule 4 — an exact (trigger, prefix, priority) duplicate throws; distinct rungs coexist', () => {
		registerInlineSyntax(':', decline);
		expect(() => registerInlineSyntax(':', decline)).toThrow(/already registered/);
		expect(() => registerInlineSyntax(':', decline, { prefix: '::', priority: 40 })).not.toThrow();
		expect(getInlineRungs(':')).toHaveLength(2);
	});
});
