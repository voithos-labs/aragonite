# Feature: Complex cross-block copy-paste — Inline Formatting Preservation

Cross-block copy across paragraphs containing inline formatting must preserve every marker (bold, italic, code, link, heading marker).

## Happy paths

- Copy across formatted + link paragraphs: all markdown markers preserved
- Copy heading through formatted paragraph: heading marker preserved
