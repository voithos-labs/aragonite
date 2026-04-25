# Feature: Blockquote Navigation — Long Permutations

Multi-step edit sequences must not leave behind state that breaks navigation later.

## Long edit permutations

- Multiple unrelated edits (create, type, delete, navigate) in sequence do not leak state that breaks navigation at the end of the sequence
