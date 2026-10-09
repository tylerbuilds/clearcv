import test from 'node:test';
import assert from 'node:assert/strict';
import { safeContactHref } from '../src/links.js';

test('valid supplied contacts produce explicit safe schemes while visible text can remain unchanged', () => {
  assert.equal(safeContactHref('website', 'alexmorgan.example/work'), 'https://alexmorgan.example/work');
  assert.equal(safeContactHref('website', 'http://example.com/cv?ref=portfolio#work'), 'http://example.com/cv?ref=portfolio#work');
  assert.equal(safeContactHref('email', 'alex+cv@example.com'), 'mailto:alex%2Bcv@example.com');
  assert.equal(safeContactHref('email', 'alex?header@example.com'), 'mailto:alex%3Fheader@example.com');
});
test('empty, unsafe and untrusted contacts are rendered as text, with no inferred links elsewhere', () => {
  for (const value of ['', 'javascript:alert(1)', 'data:text/html,test', '//example.com', 'ftp://example.com', 'https://user:secret@example.com', 'https://exa mple.com', 'https://example..com', 'some words', 'https://']) assert.equal(safeContactHref('website', value), null, value);
  for (const value of ['', 'invalid', 'alex@example.com?subject=test', 'alex@example.com\nBcc:other@example.com', 'alex@example..com']) assert.equal(safeContactHref('email', value), null, value);
  assert.equal(safeContactHref('summary', 'https://example.com'), null);
  assert.equal(safeContactHref('website', undefined), null);
});
