import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, sampleDocument } from '../src/model.js';
import { REVIEW_RULES, reviewCV, tailoringSuggestions, coverLetterDraft } from '../src/review.js';

const issue = (result, id) => result.issues.filter(item => item.ruleId === id);

test('blank CV produces actionable essentials without a hiring score', () => {
  const result = reviewCV(createDocument());
  for (const id of ['name', 'contact', 'headline', 'summary', 'background']) assert.equal(issue(result, id).length, 1);
  assert.equal(result.metrics.words, 0);
  assert.equal(Object.hasOwn(result, 'score'), false);
  assert.equal(Object.hasOwn(result, 'percentage'), false);
  for (const item of result.issues) {
    assert.ok(REVIEW_RULES.some(rule => rule.id === item.ruleId));
    assert.ok(item.message && item.suggestion && item.path);
    assert.ok(['suggestion', 'attention'].includes(item.severity));
  }
});

test('valid supplied contact is enough and malformed contact gets precise prompts', () => {
  const doc = createDocument();
  doc.profile.email = 'alex+jobs@example.co.uk';
  assert.equal(issue(reviewCV(doc), 'contact').length, 0);
  assert.equal(issue(reviewCV(doc), 'email-format').length, 0);
  doc.profile.email = 'alex @example';
  doc.profile.phone = '+44 12';
  let result = reviewCV(doc);
  assert.equal(issue(result, 'email-format').length, 1);
  assert.equal(issue(result, 'phone-format').length, 1);
  doc.profile.email = '';
  doc.profile.phone = '+44 (0)7700 900000';
  result = reviewCV(doc);
  assert.equal(issue(result, 'contact').length, 0);
  assert.equal(issue(result, 'phone-format').length, 0);
});

test('summary prompts expose length and specific generic phrase evidence', () => {
  const doc = sampleDocument();
  assert.equal(issue(reviewCV(doc), 'summary-short').length, 0);
  doc.profile.summary = 'A dynamic professional and team player.';
  const brief = reviewCV(doc);
  assert.equal(issue(brief, 'summary-short').length, 1);
  assert.equal(issue(brief, 'summary-vague')[0].evidence, 'dynamic professional');
  doc.profile.summary = Array.from({ length: 91 }, () => 'clarity').join(' ');
  assert.equal(issue(reviewCV(doc), 'summary-long').length, 1);
});

test('empty and partial entries identify missing fields without requiring irrelevant descriptions for education', () => {
  const doc = createDocument();
  doc.experience = [{ id: 'empty', title: '', organisation: '', location: '', dates: '', description: '' },
    { id: 'partial', title: '', organisation: 'Studio', location: '', dates: '', description: '' }];
  doc.education = [{ id: 'education', title: 'Course', organisation: 'College', location: '', dates: '2022', description: '' }];
  doc.skills = [{ id: 'skill', name: '' }];
  const result = reviewCV(doc);
  assert.deepEqual(issue(result, 'empty-entry').map(item => item.path), ['experience[0]', 'skills[0]']);
  assert.equal(issue(result, 'entry-title')[0].path, 'experience[1].title');
  assert.equal(issue(result, 'experience-detail').length, 1);
  assert.equal(issue(result, 'dates-missing').length, 1);
});

test('date checks accept supported formats and detect reversed periods without using current time', () => {
  for (const dates of ['2022 — Present', '2019-2022', 'Jan 2020 – Dec 2023', 'September 2020 to July 2021', '2020-01 — 2023-12', '2020', '2019 – Current']) {
    const doc = sampleDocument();
    doc.experience = [{ ...doc.experience[0], dates }];
    const result = reviewCV(doc);
    assert.equal(issue(result, 'dates-unrecognised').length, 0, dates);
    assert.equal(issue(result, 'dates-order').length, 0, dates);
  }
  for (const dates of ['2023 — 2021', 'Oct 2022 – Jan 2022', '2023-12 — 2023-01']) {
    const doc = sampleDocument();
    doc.experience = [{ ...doc.experience[0], dates }];
    assert.equal(issue(reviewCV(doc), 'dates-order').length, 1, dates);
  }
  const doc = sampleDocument();
  doc.experience[0].dates = 'Spring 2023';
  assert.equal(issue(reviewCV(doc), 'dates-unrecognised').length, 1);
  doc.experience[0].dates = '2023-13';
  assert.equal(issue(reviewCV(doc), 'dates-unrecognised').length, 1);
});

test('date consistency prompts do not assume missing months or enforce chronological entry order', () => {
  const doc = sampleDocument();
  doc.experience[0].dates = 'Jan 2018 — Dec 2019';
  doc.experience[1].dates = '2020 — 2022';
  const result = reviewCV(doc);
  assert.equal(issue(result, 'dates-consistency').length, 1);
  assert.match(issue(result, 'dates-consistency')[0].suggestion, /Do not guess/);
  assert.equal(issue(result, 'dates-order').length, 0);
});

test('quantitative prompt accepts any supplied numeral but never treats it as verified impact', () => {
  const doc = sampleDocument();
  doc.experience = [{ ...doc.experience[0], description: 'Designed a useful service for local teams.' }];
  let result = reviewCV(doc);
  assert.equal(issue(result, 'numeric-evidence').length, 1);
  assert.match(issue(result, 'numeric-evidence')[0].suggestion, /Qualitative evidence is also valid; never invent/);
  doc.experience[0].description = 'Designed a useful service for 4 local teams.';
  result = reviewCV(doc);
  assert.equal(issue(result, 'numeric-evidence').length, 0);
});

test('description review finds exact repetition, duty openings, long lines and line-count excess', () => {
  const doc = sampleDocument();
  const repeated = 'Built a service for local teams';
  doc.experience[0].description = [repeated, `${repeated.toUpperCase()}.`, 'Responsible for managing the design team.', Array.from({ length: 41 }, () => 'detail').join(' '), ...Array.from({ length: 5 }, (_, index) => `Delivered task ${index}.`)].join('\n');
  const result = reviewCV(doc);
  assert.equal(issue(result, 'repeated-bullet').length, 1);
  assert.equal(issue(result, 'responsibility-opening').length, 1);
  assert.equal(issue(result, 'long-bullet').length, 1);
  assert.equal(issue(result, 'many-bullets').length, 1);
  assert.equal(issue(result, 'repeated-bullet')[0].path, 'experience[0].description:2');
  assert.equal(result.metrics.experienceBullets, 11);
});

test('hidden sections do not generate content review issues or word counts', () => {
  const doc = sampleDocument();
  doc.experience[0].dates = '2025 — 2019';
  doc.customSections = [{ id: 'project', title: 'Projects', content: 'Responsible for a local accessibility project.' }];
  doc.hiddenSections = ['experience', 'project'];
  const result = reviewCV(doc);
  assert.equal(issue(result, 'dates-order').length, 0);
  assert.equal(issue(result, 'responsibility-opening').length, 0);
  assert.equal(result.metrics.experienceBullets, 0);
  const withoutHidden = structuredClone(doc);
  withoutHidden.experience = [];
  withoutHidden.customSections = [];
  assert.equal(result.metrics.words, reviewCV(withoutHidden).metrics.words);
});

test('hidden profile summary is excluded from all summary prompts and visible word counts while header essentials remain', () => {
  const doc = sampleDocument();
  doc.profile.summary = Array.from({ length: 1001 }, () => 'detail').join(' ');
  const visible = reviewCV(doc);
  assert.equal(issue(visible, 'summary-long').length, 1);
  assert.equal(issue(visible, 'document-long').length, 1);
  doc.hiddenSections = ['profile'];
  const result = reviewCV(doc);
  assert.equal(result.metrics.summaryWords, 0);
  assert.equal(result.metrics.words, visible.metrics.words - 1001);
  assert.equal(result.issues.some(item => item.ruleId.startsWith('summary')), false);
  assert.equal(issue(result, 'document-long').length, 0);
  doc.profile.summary = '';
  doc.profile.name = '';
  doc.profile.headline = '';
  doc.profile.email = '';
  doc.profile.phone = '';
  const withoutHeader = reviewCV(doc);
  assert.equal(issue(withoutHeader, 'summary').length, 0);
  for (const id of ['name', 'contact', 'headline']) assert.equal(issue(withoutHeader, id).length, 1);
});

test('custom sections provide background and use the same description checks', () => {
  const doc = createDocument();
  doc.customSections = [{ id: 'project', title: '', content: 'Helped with an accessible community service.' }, { id: 'award', title: 'Awards', content: '' }];
  const result = reviewCV(doc);
  assert.equal(issue(result, 'background').length, 0);
  assert.equal(issue(result, 'custom-title').length, 1);
  assert.equal(issue(result, 'custom-content').length, 1);
  assert.equal(issue(result, 'responsibility-opening')[0].path, 'customSections[0].content:1');
});

test('duplicate skills use case and whitespace only and preserve distinct technology names', () => {
  const doc = createDocument();
  doc.skills = ['User research', ' user   RESEARCH ', 'C++', 'C#'].map((name, index) => ({ id: `skill-${index}`, name }));
  assert.equal(issue(reviewCV(doc), 'duplicate-skill').length, 1);
});

test('review is deterministic, does not mutate input and returns detached rule descriptions', () => {
  const doc = sampleDocument();
  const original = structuredClone(doc);
  const first = reviewCV(doc);
  assert.deepEqual(first, reviewCV(doc));
  assert.deepEqual(doc, original);
  first.rules[0].description = 'Changed';
  assert.notEqual(reviewCV(doc).rules[0].description, 'Changed');
  doc.profile.photo = 'base64'.repeat(1000);
  assert.equal(reviewCV(doc).metrics.words, reviewCV(original).metrics.words);
});

test('tailoring ranks only existing IDs by exact overlaps and retains stable ties', () => {
  const doc = createDocument();
  doc.experience = [
    { id: 'a', title: 'Designer', organisation: 'Studio', description: 'Java service' },
    { id: 'b', title: 'Engineer', organisation: 'Studio', description: 'JavaScript accessibility' },
    { id: 'c', title: 'Developer', organisation: 'Studio', description: 'JavaScript accessibility' }
  ];
  doc.skills = [{ id: 'java', name: 'Java' }, { id: 'a11y', name: 'Accessibility' }, { id: 'js', name: 'JavaScript' }];
  const original = structuredClone(doc);
  const result = tailoringSuggestions(doc, 'JavaScript accessibility accessible');
  assert.deepEqual(result.experienceOrder, ['b', 'c', 'a']);
  assert.deepEqual(result.skillOrder, ['a11y', 'js', 'java']);
  assert.deepEqual(result.rankings.experience[0].matchedKeywords, ['accessibility', 'javascript']);
  assert.ok(result.missing.includes('accessible'));
  assert.deepEqual(doc, original);
  assert.equal(Object.hasOwn(result, 'score'), false);
  assert.equal(Object.hasOwn(result, 'percentage'), false);
  assert.match(result.suggestions.find(item => item.path === 'jobAd').message, /Only add a term/);
});

test('tailoring compares stored custom content and defaults to the saved ad, with an empty-ad prompt', () => {
  const doc = createDocument();
  doc.customSections = [{ id: 'projects', title: 'Projects', content: 'Accessibility research with C++ and UX.' }];
  doc.jobAd = 'Accessibility C++ UX';
  assert.deepEqual(tailoringSuggestions(doc).missing, []);
  assert.deepEqual(tailoringSuggestions(doc, 'and the').keywords, []);
  assert.equal(tailoringSuggestions(doc, '').suggestions[0].path, 'jobAd');
});

test('cover letter starter contains supplied facts with provenance and never makes up metrics or company knowledge', () => {
  const doc = sampleDocument();
  doc.experience[0].description = 'Created a support guide for colleagues.';
  const before = structuredClone(doc);
  const result = coverLetterDraft(doc, 'Example Organisation', 'UX Designer');
  assert.match(result.text, /UX Designer position at Example Organisation/);
  assert.ok(result.text.includes(doc.profile.summary));
  assert.ok(result.text.includes(doc.experience[0].description));
  assert.ok(result.usedPaths.includes('experience[0].description'));
  assert.ok(result.usedPaths.includes('profile.name'));
  assert.equal(/\b\d+%/.test(result.text), false);
  assert.equal(/your mission|your values|industry-leading/i.test(result.text), false);
  assert.equal(/\[company\]|\[name\]|\[role\]/i.test(result.text), false);
  assert.deepEqual(doc, before);
  assert.deepEqual(result, coverLetterDraft(doc, 'Example Organisation', 'UX Designer'));
});

test('cover letter omits missing facts, warns about gaps and can draw from education', () => {
  const doc = createDocument();
  let result = coverLetterDraft(doc);
  assert.match(result.text, /^Dear hiring team,/);
  assert.match(result.text, /Please consider my application\./);
  assert.ok(result.warnings.some(value => value.includes('no supporting CV detail')));
  assert.equal(result.usedPaths.length, 0);
  assert.equal(/undefined|null|\[.*\]/.test(result.text), false);
  doc.education = [{ id: 'study', title: 'BA Design', organisation: 'College', description: 'Built an accessible community project.' }];
  result = coverLetterDraft(doc, '', 'Graduate designer');
  assert.ok(result.text.includes('BA Design at College'));
  assert.ok(result.text.includes(doc.education[0].description));
  assert.ok(result.usedPaths.includes('education[0].description'));
});

test('structured letter body excludes generated salutation and signature while keeping facts and thank-you', () => {
  const doc = sampleDocument();
  const result = coverLetterDraft(doc, 'Example Organisation', 'UX Designer');
  assert.equal(result.salutation, 'Dear hiring team,');
  assert.equal(result.closing, 'Kind regards,');
  assert.equal(/Dear hiring team|Kind regards/.test(result.body), false);
  assert.equal(result.body.endsWith(doc.profile.name), false);
  assert.ok(result.body.includes(doc.profile.summary));
  assert.ok(result.body.includes(doc.experience[0].title));
  assert.ok(result.body.includes('UX Designer position at Example Organisation'));
  assert.ok(result.body.includes('Thank you for considering my application.'));
  assert.equal(result.text, `${result.salutation}\n\n${result.body}\n\n${result.closing}\n${doc.profile.name}`);
  assert.equal(coverLetterDraft(createDocument()).text, 'Dear hiring team,\n\nPlease consider my application.\n\nThank you for considering my application. I would welcome the opportunity to discuss it.\n\nKind regards,');
});
