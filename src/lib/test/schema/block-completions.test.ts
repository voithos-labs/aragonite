import { defaultGrammarView } from '$lib/schema/block-openers';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	registerBlockCompleter,
	completeTypedLine,
	type BlockCompleter,
	type CompletionResult
} from '../../schema/block-completions';
import { declarePluginKind } from '../../schema/plugin-kind';
import { __resetSchemaRegistriesForTests } from '../../schema/registry-reset';
import { configureEditorEnv } from '../../env';
import { takeDevWarns } from '../support/warn-gate';

function claims(marker: string, lines: string[]): BlockCompleter {
	return {
		tryComplete: (line): CompletionResult | null =>
			line.startsWith(marker) ? { lines, caret: { path: [1, 0], line: 0, column: 0 } } : null
	};
}

describe('block-completion registry', () => {
	// Module-global, like the opener registry it mirrors. The built-in table completer stays,
	// and each case's own kinds sort ahead of it by name.
	beforeEach(() => __resetSchemaRegistriesForTests());
	afterEach(() => __resetSchemaRegistriesForTests());

	it('returns the first claim and leaves an unclaimed line alone', () => {
		registerBlockCompleter(declarePluginKind('spec-pipe'), claims('|', ['a', 'b']));
		expect(completeTypedLine('| x |', defaultGrammarView)?.lines).toEqual(['a', 'b']);
		expect(completeTypedLine('plain prose', defaultGrammarView)).toBeNull();
	});

	// The half of the openers' order rule that matters: which completer wins follows from the
	// declarations, so swapping the registration calls must not swap the winner.
	it('consults completers in kind-name order, not registration order', () => {
		registerBlockCompleter(declarePluginKind('spec-zulu'), claims('|', ['zulu']));
		registerBlockCompleter(declarePluginKind('spec-alpha'), claims('|', ['alpha']));
		expect(completeTypedLine('|', defaultGrammarView)?.lines).toEqual(['alpha']);

		__resetSchemaRegistriesForTests();
		registerBlockCompleter(declarePluginKind('spec-alpha-2'), claims('|', ['alpha']));
		registerBlockCompleter(declarePluginKind('spec-zulu-2'), claims('|', ['zulu']));
		expect(completeTypedLine('|', defaultGrammarView)?.lines).toEqual(['alpha']);
	});

	it('re-reads the registry after a later registration (cache invalidation)', () => {
		registerBlockCompleter(declarePluginKind('spec-zulu'), claims('|', ['zulu']));
		expect(completeTypedLine('|', defaultGrammarView)?.lines).toEqual(['zulu']);
		registerBlockCompleter(declarePluginKind('spec-alpha'), claims('|', ['alpha']));
		expect(completeTypedLine('|', defaultGrammarView)?.lines).toEqual(['alpha']);
	});

	it('throws on a duplicate kind under test, keeping the first registration', () => {
		const kind = declarePluginKind('spec-dup');
		registerBlockCompleter(kind, claims('|', ['first']));
		expect(() => registerBlockCompleter(kind, claims('|', ['second']))).toThrow(
			/already registered/
		);
		expect(completeTypedLine('|', defaultGrammarView)?.lines).toEqual(['first']);
	});

	it('replaces with a note instead of throwing on a dev server (registrar re-eval)', () => {
		const kind = declarePluginKind('spec-hmr');
		registerBlockCompleter(kind, claims('|', ['first']));
		configureEditorEnv({ isDev: true, isTest: false });

		expect(() => registerBlockCompleter(kind, claims('|', ['second']))).not.toThrow();
		expect(completeTypedLine('|', defaultGrammarView)?.lines).toEqual(['second']);
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toMatch(/dev re-registration replaces/);
	});
});
