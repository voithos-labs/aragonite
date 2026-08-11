import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	registerBlockCompleter,
	completeTypedLine,
	__resetBlockCompletersForTests,
	type BlockCompleter,
	type CompletionResult
} from '../../schema/block-completions';
import { declarePluginKind } from '../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { configureEditorEnv, resetEditorEnv } from '../../env';

function claims(marker: string, lines: string[]): BlockCompleter {
	return {
		tryComplete: (line): CompletionResult | null =>
			line.startsWith(marker) ? { lines, caret: { path: [1, 0], offset: 0 } } : null
	};
}

describe('block-completion registry', () => {
	// Module-global, like the opener registry it mirrors; the built-in table completer is
	// among the entries this clears, so every case here declares its own.
	beforeEach(() => {
		__resetBlockCompletersForTests();
		__resetSchemaRegistriesForTests();
	});
	afterEach(() => {
		resetEditorEnv();
		__resetBlockCompletersForTests();
	});

	it('returns the first claim and leaves an unclaimed line alone', () => {
		registerBlockCompleter(declarePluginKind('spec-pipe'), claims('|', ['a', 'b']));
		expect(completeTypedLine('| x |')?.lines).toEqual(['a', 'b']);
		expect(completeTypedLine('plain prose')).toBeNull();
	});

	// The load-bearing half of the openers' order rule: which claim wins is a function of the
	// declarations, so swapping the registration calls must not swap the winner.
	it('consults completers in kind-name order, not registration order', () => {
		registerBlockCompleter(declarePluginKind('spec-zulu'), claims('|', ['zulu']));
		registerBlockCompleter(declarePluginKind('spec-alpha'), claims('|', ['alpha']));
		expect(completeTypedLine('|')?.lines).toEqual(['alpha']);

		__resetBlockCompletersForTests();
		registerBlockCompleter(declarePluginKind('spec-alpha-2'), claims('|', ['alpha']));
		registerBlockCompleter(declarePluginKind('spec-zulu-2'), claims('|', ['zulu']));
		expect(completeTypedLine('|')?.lines).toEqual(['alpha']);
	});

	it('re-reads the registry after a later registration (cache invalidation)', () => {
		registerBlockCompleter(declarePluginKind('spec-zulu'), claims('|', ['zulu']));
		expect(completeTypedLine('|')?.lines).toEqual(['zulu']);
		registerBlockCompleter(declarePluginKind('spec-alpha'), claims('|', ['alpha']));
		expect(completeTypedLine('|')?.lines).toEqual(['alpha']);
	});

	it('throws on a duplicate kind under test, keeping the first registration', () => {
		const kind = declarePluginKind('spec-dup');
		registerBlockCompleter(kind, claims('|', ['first']));
		expect(() => registerBlockCompleter(kind, claims('|', ['second']))).toThrow(
			/already registered/
		);
		expect(completeTypedLine('|')?.lines).toEqual(['first']);
	});

	it('replaces with a note instead of throwing on a dev server (registrar re-eval)', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const kind = declarePluginKind('spec-hmr');
		registerBlockCompleter(kind, claims('|', ['first']));
		configureEditorEnv({ isDev: true, isTest: false });

		expect(() => registerBlockCompleter(kind, claims('|', ['second']))).not.toThrow();
		expect(completeTypedLine('|')?.lines).toEqual(['second']);
		expect(warnSpy.mock.calls[0][0]).toMatch(/dev re-registration replaces/);
		warnSpy.mockRestore();
	});
});
