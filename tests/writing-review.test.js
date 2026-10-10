import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleDocument } from '../src/model.js';
import { writingFields, joinWritingFields, locateWritingIssue, applyWritingSuggestion, cleanupSuggestions, applyCleanupSuggestion } from '../src/writing-review.js';

test('writing scope excludes contact details, hidden source, dates and pasted job ad', () => {
  const doc = sampleDocument(); doc.hiddenSections = ['education']; doc.customSections = [{ id: 'source', title: 'Source', content: 'original untouched facts' }]; doc.sectionOrder.push('source'); doc.hiddenSections.push('source'); doc.jobAd = 'private job advertisement';
  const fields = writingFields(doc); assert(!fields.some(field => ['education', 'customSections'].includes(field.path[0])));
  const joined = joinWritingFields(fields); assert(!joined.text.includes(doc.profile.email)); assert(!joined.text.includes('private job advertisement')); assert(!joined.text.includes('2022'));
});
test('dictionary offsets map to exact supplied field and correction preserves all other data', () => {
  const doc = sampleDocument(); doc.profile.summary = 'I have experiance with research.';
  const fields = writingFields(doc), joined = joinWritingFields(fields), offset = joined.text.indexOf('experiance');
  const issue = locateWritingIssue(joined.ranges, { word: 'experiance', start: offset, end: offset + 10, suggestions: ['experience'] });
  const next = applyWritingSuggestion(doc, issue, 'experience'); assert.equal(next.profile.summary, 'I have experience with research.');
  const before = structuredClone(doc); before.profile.summary = next.profile.summary; assert.deepEqual(next, before); assert.equal(doc.profile.summary, 'I have experiance with research.');
});
test('stale offsets, unknown fields, unsafe replacements and deleted rows fail without mutation', () => {
  const doc = sampleDocument(), before = JSON.stringify(doc);
  assert.throws(() => applyWritingSuggestion(doc, { path: ['profile', 'summary'], start: 0, end: 5, word: 'wrong' }, 'right'), /changed/);
  assert.throws(() => applyWritingSuggestion(doc, { path: ['profile', 'email'] }, 'x'), /supported/);
  assert.throws(() => applyWritingSuggestion(doc, { path: ['experience', 'gone', 'description'] }, 'x'), /no longer/);
  assert.throws(() => applyWritingSuggestion(doc, { path: ['profile', 'summary'], start: 0, end: 1, word: 'I' }, 'a\nb'), /plain-text/);
  assert.equal(JSON.stringify(doc), before);
});
test('reviewed cleanup only normalises whitespace and keeps words, values and source immutable', () => {
  const doc = sampleDocument(); doc.experience[0].description = '  Delivered  £42,000  in value.\t\n\n\n  Worked with Zoë.  ';
  const suggestions = cleanupSuggestions(doc); assert.equal(suggestions.length, 1);
  const next = applyCleanupSuggestion(doc, suggestions[0]); assert.equal(next.experience[0].description, 'Delivered £42,000 in value.\n\nWorked with Zoë.');
  assert.equal(doc.experience[0].description, suggestions[0].before);
  assert.throws(() => applyCleanupSuggestion(doc, { ...suggestions[0], replacement: 'Delivered £99,000' }), /facts/);
  assert.throws(() => applyCleanupSuggestion(next, suggestions[0]), /changed/);
});
test('cover letter spelling and cleanup are independent of CV prose', () => {
  const doc = sampleDocument(); doc.coverLetter.body = ' A  thoughtful letter. ';
  const fields = writingFields(doc, 'letter'); assert(fields.every(field => field.path[0] === 'coverLetter'));
  const suggestions = cleanupSuggestions(doc, 'letter'); assert.equal(suggestions.length, 1);
  const next = applyCleanupSuggestion(doc, suggestions[0]); assert.equal(next.coverLetter.body, 'A thoughtful letter.'); assert.deepEqual(next.profile, doc.profile);
});

test('visible headings participate in spelling and correction without changing source or hidden headings', () => {
  const doc = sampleDocument(); doc.sectionTitles.experience = 'Experiance';
  doc.customSections = [{ id: 'volunteer', title: 'Volunteerr', content: 'Supplied community work.' }, { id: 'raw', title: 'Unknwon', content: 'Exact rawsource' }]; doc.sectionOrder.push('volunteer', 'raw'); doc.hiddenSections.push('raw');
  const fields = writingFields(doc); assert(fields.some(field => field.path[0] === 'sectionTitles' && field.value === 'Experiance')); assert(fields.some(field => field.path[2] === 'title' && field.value === 'Volunteerr')); assert(!fields.some(field => field.value === 'Unknwon'));
  const next = applyWritingSuggestion(doc, { path: ['sectionTitles', 'experience'], word: 'Experiance', start: 0, end: 10 }, 'Experience');
  assert.equal(next.sectionTitles.experience, 'Experience'); assert.equal(doc.sectionTitles.experience, 'Experiance'); assert.equal(next.customSections[1].content, 'Exact rawsource');
});
