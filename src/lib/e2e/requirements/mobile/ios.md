# Feature: the editor under the real iOS keyboard

The rows in `scripts/mobile/ios-rows.mjs`, which `.github/workflows/mobile-input.yml` runs in
Mobile Safari on the iOS Simulator through Appium. Taps are native taps and keys are taps on the
on-screen keyboard. Each bullet's name before the colon is the row's key, and
`mobile-rows-lockstep.test.ts` holds the two lists to each other.

## Keyboard

- types a word through the on-screen keyboard: a tap on a paragraph brings up the keyboard, and
  tapping its keys types `hello` at the caret. Every event is trusted, and the same word sent
  by WebDriver's `sendKeys` (untrusted) is told apart.
