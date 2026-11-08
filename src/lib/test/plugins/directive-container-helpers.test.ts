import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { chromeChild, declarePluginKind } from '#lib/plugin.js';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { testView } from '#lib/test/harness/test-view.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';
import { defaultGrammarView } from '#lib/schema/editor-grammar.js';

// The colon writer is the one every `:::` container uses, so its byte assembly is pinned once
// here, through the callout that declares it.

describe('the colon writer threads the authored line ending', () => {
	beforeEach(() => {
		registerCalloutKind(testView());
	});

	// What the factory exists to prevent: a hand-written copy that forgot `lineEnding`
	// rewrites the opener and closer it builds to `\n`.
	it('reproduces CRLF on the opener and closer when a child edit rebuilds', () => {
		const callout = parse(':::callout My Title\r\nBody\r\n:::\r\n').children[0];
		callout.children![1].raw = 'edited\r\n';
		writeContainerRaw(callout, defaultGrammarView);
		expect(callout.raw).toBe(':::callout My Title\r\nedited\r\n:::\r\n');
	});

	it('keeps LF chrome lines for an LF-authored directive', () => {
		const callout = parse(':::callout My Title\nBody\n:::\n').children[0];
		callout.children![1].raw = 'edited\n';
		writeContainerRaw(callout, defaultGrammarView);
		expect(callout.raw).toBe(':::callout My Title\nedited\n:::\n');
	});

	it('re-emits the opener line from child 0, variant name and title included', () => {
		const callout = parse(':::aside Watch out\r\nBody\r\n:::\r\n').children[0];
		writeContainerRaw(callout, defaultGrammarView);
		expect(callout.raw).toBe(':::aside Watch out\r\nBody\r\n:::\r\n');
	});

	it('keeps a bare opener line bare', () => {
		const callout = parse(':::callout\nBody\n:::\n').children[0];
		writeContainerRaw(callout, defaultGrammarView);
		expect(callout.raw).toBe(':::callout\nBody\n:::\n');
	});
});

describe('chromeChild builds the reserved child-0 node', () => {
	it('appends a trailing newline to non-empty title text', () => {
		const summary = declarePluginKind('summary-row');
		const child = chromeChild(summary, 'Heads up');
		expect(child).toMatchObject({ kind: summary, leadingTrivia: '', raw: 'Heads up\n' });
	});

	it('collapses empty text to a bare newline so the leaf still holds a line', () => {
		expect(chromeChild(declarePluginKind('summary-row'), '').raw).toBe('\n');
	});
});
