// Reads an input recording's event stream: its shape for the report, and whether it is the shape a
// soft keyboard gives (on Android) or merely trusted keyboard input (on iOS).

export function events(recording) {
	return (recording?.steps ?? []).flatMap((step) => step.events);
}

export function shape(recording) {
	const all = events(recording);
	const count = (list, field) =>
		list.reduce((acc, e) => ((acc[e[field]] = (acc[e[field]] ?? 0) + 1), acc), {});
	return {
		events: all.length,
		untrusted: all.filter((e) => !e.trusted).length,
		keydowns: all
			.filter((e) => e.type === 'keydown')
			.map((e) => `${e.key}/${e.keyCode}${e.isComposing ? '/composing' : ''}`),
		inputTypes: count(
			all.filter((e) => e.type === 'beforeinput'),
			'inputType'
		),
		composed: all.some((e) => e.type === 'compositionend'),
		pointerTypes: count(
			all.filter((e) => e.type === 'pointerdown'),
			'pointerType'
		)
	};
}

// Chrome on Android: every keydown unnamed (keyCode 229), the text arriving as keyboard input
// (committed or composed), nothing synthetic. Whether Gboard composed depends on the field, so the
// shape reports it and the judgement does not ask for it.
const KEYBOARD_INPUT = new Set(['insertText', 'insertCompositionText']);
export function softKeyboardReasons(recording) {
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
	return reasons;
}

/** Whether two recordings differ in what a guard reads: key names, input types, composition, trust. */
export function distinguishable(a, b) {
	const sig = (s) =>
		JSON.stringify([s.keydowns, Object.keys(s.inputTypes).sort(), s.composed, s.untrusted > 0]);
	return sig(shape(a)) !== sig(shape(b));
}
