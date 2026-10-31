// Judges a typing run: did the word land at the caret, and does the real keyboard's event stream
// look different from the programmatic control's? On Android it also asserts the soft keyboard's
// shape (trusted keyCode 229 keydowns, text by keyboard input types); on iOS it reports the shape.
// Usage: node check-recording.mjs <android|ios> <result.json>; exits 1 when the run fails.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [platform, resultPath] = process.argv.slice(2);
const result = JSON.parse(readFileSync(resultPath, 'utf8'));

function events(recording) {
	return (recording?.steps ?? []).flatMap((step) => step.events);
}

function shape(recording) {
	const all = events(recording);
	const keydowns = all.filter((e) => e.type === 'keydown');
	const inputs = all.filter((e) => e.type === 'beforeinput');
	const count = (list, field) =>
		list.reduce((acc, e) => ((acc[e[field]] = (acc[e[field]] ?? 0) + 1), acc), {});
	return {
		events: all.length,
		untrusted: all.filter((e) => !e.trusted).length,
		keydowns: keydowns.map((e) => `${e.key}/${e.keyCode}${e.isComposing ? '/composing' : ''}`),
		inputTypes: count(inputs, 'inputType'),
		compositions: all.filter((e) => e.type.startsWith('composition')).map((e) => e.type),
		pointerTypes: count(
			all.filter((e) => e.type === 'pointerdown'),
			'pointerType'
		),
		families: (recording?.steps ?? []).map((step) => step.family)
	};
}

// What a soft keyboard's word looks like in Chrome on Android: every keydown unnamed (keyCode 229),
// the text arriving as keyboard input (committed or composed), and nothing synthetic. Whether
// Gboard composed is reported in the shape, since it depends on the field, not on the route.
const KEYBOARD_INPUT = new Set(['insertText', 'insertCompositionText']);
function androidSoftKeyboard(recording) {
	const all = events(recording);
	const keydowns = all.filter((e) => e.type === 'keydown');
	const inputs = all.filter((e) => e.type === 'beforeinput');
	const reasons = [];
	if (keydowns.length === 0) reasons.push('no keydowns');
	const named = keydowns.filter((e) => e.keyCode !== 229 || e.key !== 'Unidentified');
	if (named.length) reasons.push(`${named.length} keydown(s) not 229/Unidentified`);
	if (inputs.length === 0) reasons.push('no beforeinput');
	const other = inputs.filter((e) => !KEYBOARD_INPUT.has(e.inputType));
	if (other.length) reasons.push(`input types ${other.map((e) => e.inputType).join(', ')}`);
	if (all.some((e) => !e.trusted)) reasons.push('untrusted events');
	if (!recording?.env?.uaData?.mobile) reasons.push('uaData.mobile is not true');
	if (recording?.env?.pointer !== 'coarse') reasons.push(`pointer is ${recording?.env?.pointer}`);
	return {
		pass: reasons.length === 0,
		reasons,
		composed: all.some((e) => e.type === 'compositionend')
	};
}

function signature(s) {
	return JSON.stringify([
		s.keydowns,
		Object.keys(s.inputTypes).sort(),
		s.compositions.length > 0,
		s.untrusted > 0
	]);
}

const verdict = { platform, trials: {} };
for (const [name, trial] of Object.entries(result.trials)) {
	verdict.trials[name] = {
		method: trial.method,
		landed: typeof trial.expected === 'string' && trial.actual === trial.expected,
		expected: trial.expected,
		actual: trial.actual,
		error: trial.error,
		shape: shape(trial.recording),
		softKeyboard: platform === 'android' ? androidSoftKeyboard(trial.recording) : undefined
	};
}
const { real, control } = verdict.trials;
verdict.distinguishable = !!real && !!control && signature(real.shape) !== signature(control.shape);
verdict.pass =
	platform === 'android'
		? !!real?.landed && !!real.softKeyboard.pass && !!control && !control.softKeyboard.pass
		: !!real?.landed && verdict.distinguishable;

writeFileSync(
	path.join(path.dirname(resultPath), 'verdict.json'),
	JSON.stringify(verdict, null, 2)
);
const summary = [
	`### ${platform}: ${verdict.pass ? 'PASS' : 'FAIL'}`,
	'```json',
	JSON.stringify(verdict, null, 2),
	'```',
	''
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.exit(verdict.pass ? 0 : 1);
