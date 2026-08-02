import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { chromeChild, declaredPluginKind } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	registerCalloutKind,
	rebuildCalloutRaw,
	CALLOUT_TITLE
} from '../../../routes/test/plugins/callout/callout-kind';

// `createDirectiveRebuild` is the shared body behind both callout and admonitions (the
// only per-kind difference is the name resolver), so its byte-assembly is pinned once
// here, through the callout instance that binds it.

describe('createDirectiveRebuild threads the authored line ending', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerCalloutKind();
	});

	// The guard the factory exists for: a hand-written copy that forgot `lineEnding`
	// normalizes the synthesized opener and closer to `\n`.
	it('reproduces CRLF on the opener and closer when a child edit rebuilds', () => {
		const callout = parse(':::callout My Title\r\nBody\r\n:::\r\n').children[0];
		callout.children![1].raw = 'edited\r\n';
		rebuildCalloutRaw(callout);
		expect(callout.raw).toBe(':::callout My Title\r\nedited\r\n:::\r\n');
	});

	it('keeps LF chrome lines for an LF-authored directive', () => {
		const callout = parse(':::callout My Title\nBody\n:::\n').children[0];
		callout.children![1].raw = 'edited\n';
		rebuildCalloutRaw(callout);
		expect(callout.raw).toBe(':::callout My Title\nedited\n:::\n');
	});

	it('re-emits the title from child 0 and the variant name from metadata', () => {
		const callout = parse(':::aside Watch out\r\nBody\r\n:::\r\n').children[0];
		rebuildCalloutRaw(callout);
		expect(callout.raw).toBe(':::aside Watch out\r\nBody\r\n:::\r\n');
	});

	it('drops the opener info when child 0 is empty', () => {
		const callout = parse(':::callout\nBody\n:::\n').children[0];
		rebuildCalloutRaw(callout);
		expect(callout.raw).toBe(':::callout\nBody\n:::\n');
	});
});

describe('chromeChild builds the reserved child-0 node', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerCalloutKind();
	});

	it('appends a trailing newline to non-empty title text', () => {
		const child = chromeChild(declaredPluginKind(CALLOUT_TITLE), 'Heads up');
		expect(child).toMatchObject({ kind: CALLOUT_TITLE, leadingTrivia: '', raw: 'Heads up\n' });
	});

	it('collapses empty text to a bare newline so the leaf still holds a line', () => {
		expect(chromeChild(declaredPluginKind(CALLOUT_TITLE), '').raw).toBe('\n');
	});
});
