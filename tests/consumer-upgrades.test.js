import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, sampleDocument, validateDocument, parseDocument, serialiseDocument, addCustomSection, removeCustomSection, updateItem, removeItem, reconcileRichText } from '../src/model.js';
import { createWorkspace, validateWorkspace, parseWorkspace, serialiseWorkspace, saveReusableLetter, useReusableLetter, removeReusableLetter, addDocument, MAX_CVS } from '../src/workspace.js';
import { applyFormatting, applyLink } from '../src/rich-text.js';
import { prepareTailoredCopy, reviewTailoredCopy, jobRequirementChecks } from '../src/tailoring.js';
import { applyWritingSuggestion, applyCleanupSuggestion } from '../src/writing-review.js';
import { mergeReviewedDocument } from '../src/import-workspace.js';
import { exportDocx, extractDocx } from '../src/formats.js';
import { coverLetterDraft } from '../src/review.js';

test('old v1 documents and workspaces acquire layout/letter defaults without changing source text', () => {
  const doc = sampleDocument();
  delete doc.richText; delete doc.sectionColumns; delete doc.layout.columns; delete doc.layout.columnRatio;
  const workspace = createWorkspace(doc); delete workspace.letters;
  const parsed = parseWorkspace(JSON.stringify(workspace));
  assert.deepEqual(parsed.letters, []);
  assert.equal(parsed.documents[0].document.layout.columns, 1);
  assert.equal(parsed.documents[0].document.profile.summary, doc.profile.summary);
  assert.deepEqual(parsed.documents[0].document.richText, {});
  assert.deepEqual(parseWorkspace(serialiseWorkspace(parsed)), parsed);
});
test('columns, custom colour, fonts and range marks survive document JSON and invalid metadata is refused', () => {
  const doc = sampleDocument(); doc.layout = { ...doc.layout, columns: 2, columnRatio: 'balanced', font: 'book' };
  doc.sectionColumns = { profile: 'side', education: 'main' }; doc.style = { template: 'folio', accent: '#123AbC' };
  doc.richText['profile.summary'] = applyFormatting(doc.profile.summary, [], 0, 7, 'bold');
  assert.deepEqual(parseDocument(serialiseDocument(doc)), doc);
  for (const mutate of [
    value => { value.layout.columns = '2'; }, value => { value.sectionColumns.lost = 'main'; },
    value => { value.sectionColumns.profile = 'footer'; }, value => { value.richText['profile.name'] = [{ start: 0, end: 1, bold: true }]; },
    value => { value.richText['profile.summary'][0].end = 99999; }, value => { value.richText = null; }
  ]) { const value = structuredClone(doc); mutate(value); assert.throws(() => validateDocument(value)); }
});
test('editing and removing entries keeps only unaffected formatting and removes abandoned placement', () => {
  let doc = sampleDocument(); doc.experience[0].description = 'First proof. Second proof.';
  doc.richText['experience.exp-1.description'] = [{ start: 13, end: 19, italic: true }];
  const edited = updateItem(doc, 'experience', 'exp-1', 'description', 'NEW First proof. Second proof.');
  assert.deepEqual(edited.richText['experience.exp-1.description'], [{ start: 17, end: 23, italic: true }]);
  assert.equal(doc.experience[0].description, 'First proof. Second proof.');
  assert.deepEqual(removeItem(edited, 'experience', 'exp-1').richText, {});
  doc = addCustomSection(doc, 'writing', 'Writing'); doc.customSections[0].content = 'Article';
  doc.richText['customSections.writing.content'] = [{ start: 0, end: 7, underline: true }]; doc.sectionColumns.writing = 'side';
  const removed = removeCustomSection(doc, 'writing');
  assert.ok(!Object.hasOwn(removed.richText, 'customSections.writing.content'));
  assert.ok(!Object.hasOwn(removed.sectionColumns, 'writing'));
});
test('spelling and spacing changes adjust ranges before validation, retaining unaffected links', () => {
  const doc = createDocument(); doc.profile.summary = 'Teh  portfolio';
  doc.richText['profile.summary'] = applyLink(doc.profile.summary, [], 5, 14, 'https://example.org/work');
  const corrected = applyWritingSuggestion(doc, { path: ['profile', 'summary'], start: 0, end: 3, word: 'Teh' }, 'The');
  assert.equal(corrected.profile.summary, 'The  portfolio');
  const tidy = applyCleanupSuggestion(corrected, { path: ['profile', 'summary'], before: 'The  portfolio', replacement: 'The portfolio' });
  assert.deepEqual(tidy.richText['profile.summary'], [{ start: 4, end: 13, href: 'https://example.org/work' }]);
});
test('reviewed import remaps formatting IDs and replaces summary formatting without touching the original', () => {
  const current = sampleDocument(); current.richText['profile.summary'] = [{ start: 0, end: 7, bold: true }];
  let incoming = sampleDocument(); incoming.profile.summary = 'Short summary';
  incoming.richText['profile.summary'] = [{ start: 0, end: 5, italic: true }];
  incoming.experience[0].description = 'Proof from a portfolio'; incoming.richText['experience.exp-1.description'] = [{ start: 13, end: 22, href: 'https://example.org/' }];
  incoming = addCustomSection(incoming, 'project', 'Project'); incoming.customSections[0].content = 'Research';
  incoming.richText['customSections.project.content'] = [{ start: 0, end: 8, underline: true }]; incoming.sectionColumns.project = 'side';
  const merged = mergeReviewedDocument(current, incoming, { profileFields: ['summary'], sectionModes: { experience: 'replace' } });
  assert.equal(current.profile.summary.startsWith('Product'), true);
  assert.deepEqual(merged.richText['profile.summary'], incoming.richText['profile.summary']);
  const first = merged.experience[0]; assert.ok(first.id !== 'exp-1');
  assert.deepEqual(merged.richText[`experience.${first.id}.description`], incoming.richText['experience.exp-1.description']);
  const custom = merged.customSections[0]; assert.equal(merged.sectionColumns[custom.id], 'side');
  assert.deepEqual(parseDocument(serialiseDocument(merged)), merged);
});
test('saved letters are detached reusable documents and survive backup without changing CV identity', () => {
  const doc = sampleDocument(); doc.coverLetter.body = 'My portfolio shows the work.';
  doc.richText['coverLetter.body'] = applyLink(doc.coverLetter.body, [], 3, 12, 'https://example.org/work');
  const original = createWorkspace(doc);
  let workspace = saveReusableLetter(original, 'letter-a', 'Design introduction');
  assert.equal(original.letters.length, 0);
  workspace = addDocument(workspace, createDocument(), 'another', 'Another CV');
  workspace = useReusableLetter(workspace, 'letter-a');
  const opened = workspace.documents.find(item => item.id === workspace.activeId).document;
  assert.equal(opened.profile.name, ''); assert.equal(opened.coverLetter.body, doc.coverLetter.body);
  assert.deepEqual(opened.richText['coverLetter.body'], doc.richText['coverLetter.body']);
  assert.deepEqual(parseWorkspace(serialiseWorkspace(workspace)), workspace);
  assert.equal(removeReusableLetter(workspace, 'letter-a').letters.length, 0);
  assert.equal(opened.coverLetter.body, doc.coverLetter.body);
  assert.throws(() => useReusableLetter(workspace, 'missing'), /not found/);
  assert.throws(() => saveReusableLetter(workspace, 'bad-name', null), /Saved letter name/);
});
test('saved letter quota, duplicate IDs and unrelated field formatting fail before persistence', () => {
  const workspace = createWorkspace(createDocument());
  const saved = { id: 'letter', name: 'Introduction', coverLetter: createDocument().coverLetter, richText: {} };
  workspace.letters = Array.from({ length: 20 }, (_, index) => ({ ...structuredClone(saved), id: `letter-${index}` }));
  assert.equal(validateWorkspace(workspace).letters.length, 20);
  assert.throws(() => saveReusableLetter(workspace, 'overflow', 'Overflow'), /at most 20/);
  workspace.letters[1].id = workspace.letters[0].id; assert.throws(() => validateWorkspace(workspace), /unique ID/);
  workspace.letters = [{ ...saved, richText: { 'profile.summary': [{ start: 0, end: 1, bold: true }] } }];
  assert.throws(() => validateWorkspace(workspace));
});
test('100 short CVs fit while count and UTF-8 workspace quota remain bounded', () => {
  const workspace = createWorkspace(createDocument());
  workspace.documents = Array.from({ length: MAX_CVS }, (_, index) => ({ id: `cv-${index}`, name: `CV ${index}`, document: createDocument(), versions: [] }));
  workspace.activeId = 'cv-0'; assert.equal(parseWorkspace(serialiseWorkspace(workspace)).documents.length, 100);
  workspace.documents.push({ ...workspace.documents[0], id: 'overflow' }); assert.throws(() => validateWorkspace(workspace), /between 1 and 100/);
  workspace.documents.pop();
  let large = createDocument();
  for (let index = 0; index < 5; index++) { large = addCustomSection(large, `s-${index}`, 'Career facts'); large.customSections[index].content = '🪴'.repeat(15000); }
  workspace.documents = workspace.documents.slice(0, 20).map(entry => ({ ...entry, document: structuredClone(large) }));
  assert.throws(() => validateWorkspace(workspace), /over 4 MB/);
});
test('whole-job draft uses master facts, ranks real evidence and reviewed choices create detached content', () => {
  const master = sampleDocument(); master.profile.summary = 'Design and research experience.';
  master.experience[0].description = 'Built a design system.\nDelivered accessible JavaScript prototypes.';
  master.experience[1].description = 'Designed accessible JavaScript prototypes.';
  const style = createDocument(); style.style.template = 'ledger'; style.layout.columns = 2;
  const before = structuredClone(master), prepared = prepareTailoredCopy(master, 'Requirements\nJavaScript prototypes and accessibility required.\nPreferred\nResearch workshops.', { styleFrom: style, company: 'Example Studio', role: 'Designer' });
  assert.deepEqual(master, before);
  assert.equal(prepared.document.style.template, 'ledger');
  assert.ok(prepared.document.experience[0].description.startsWith('Delivered'));
  const chosen = reviewTailoredCopy(prepared.document, { summary: 'Reviewed real experience.', experience: [{ id: 'exp-2', description: 'Designed accessible JavaScript prototypes.' }], skillIds: ['skill-2'], letter: 'A reviewed letter.' });
  assert.deepEqual(chosen.experience.map(item => item.id), ['exp-2']);
  assert.equal(chosen.skills[0].name, 'User research');
  assert.equal(chosen.coverLetter.body, 'A reviewed letter.');
  assert.equal(prepared.document.experience.length, 2);
  assert.throws(() => reviewTailoredCopy(prepared.document, { experience: [{ id: 'invented' }] }), /reviewed entry/);
  assert.throws(() => reviewTailoredCopy(prepared.document, { skillIds: ['invented'] }), /career record/);
  assert.deepEqual(parseDocument(serialiseDocument(chosen)), chosen);
});
test('requirement evidence omits hidden content and does not infer years or ATS success', () => {
  const doc = sampleDocument(); doc.profile.summary = 'JavaScript'; doc.hiddenSections = ['profile'];
  const result = jobRequirementChecks(doc, 'Requirements\n3 years of JavaScript development required.\nPreferred\nFigma design experience.');
  assert.equal(result.requirements[0].type, 'required'); assert.equal(result.requirements[1].type, 'preferred');
  assert.ok(result.requirements[0].missing.includes('javascript'));
  assert.ok(result.yearsPrompts[0].startsWith('3 years'));
  assert.match(result.method, /do not prove.*ATS/);
  assert.equal(Object.hasOwn(result, 'percentage'), false);
});
test('local letter starter excludes hidden career facts instead of leaking them into a visible letter', () => {
  const doc = sampleDocument(); doc.hiddenSections = ['profile', 'experience', 'education', 'skills'];
  const result = coverLetterDraft(doc, 'Example', 'Designer');
  assert.doesNotMatch(result.body, /Northstar|six years|Figma|University/);
  assert.ok(result.body.includes('Example'));
});
test('tailoring boundary rejects accessor/sparse/oversized arrays and hidden record fields without invoking getters', () => {
  const doc = sampleDocument(); let calls = 0;
  const entries = []; Object.defineProperty(entries, '0', { enumerable: true, configurable: true, get() { calls++; return { id: 'exp-1' }; } });
  assert.throws(() => reviewTailoredCopy(doc, { experience: entries })); assert.equal(calls, 0);
  const skills = []; Object.defineProperty(skills, '0', { enumerable: true, get() { calls++; return 'skill-1'; } });
  assert.throws(() => reviewTailoredCopy(doc, { skillIds: skills })); assert.equal(calls, 0);
  assert.throws(() => reviewTailoredCopy(doc, { experience: new Array(1) }));
  assert.throws(() => reviewTailoredCopy(doc, { skillIds: Array(100000).fill('skill-1') }));
  const edits = {}; Object.defineProperty(edits, 'summary', { enumerable: false, value: 'Hidden change' });
  assert.throws(() => reviewTailoredCopy(doc, edits));
});
test('tailoring options reject getters before destructuring any source or target values', () => {
  const doc = sampleDocument(); let calls = 0;
  const options = { get company() { calls++; return 'Example'; } };
  assert.throws(() => prepareTailoredCopy(doc, 'Required design experience', options));
  assert.equal(calls, 0);
});
test('DOCX preserves safe inline marks and links, escapes XML and retains visible text on extraction', async () => {
  const doc = createDocument(); doc.profile.name = 'Avery Quinn'; doc.profile.summary = 'A portfolio & real work.';
  doc.richText['profile.summary'] = applyLink(doc.profile.summary, applyFormatting(doc.profile.summary, [], 2, 11, 'bold'), 2, 11, 'https://example.org/?a=1&b=2');
  const bytes = exportDocx(doc), xml = new TextDecoder().decode(bytes);
  assert.match(xml, /<w:b\/>/); assert.match(xml, /<w:hyperlink r:id="rId2">/);
  assert.ok(xml.includes('Target="https://example.org/?a=1&amp;b=2"'));
  assert.match(await extractDocx(bytes), /portfolio \(https:\/\/example.org\/\?a=1&b=2\)/);
  assert.ok((await extractDocx(bytes)).includes('& real work.'));
});
