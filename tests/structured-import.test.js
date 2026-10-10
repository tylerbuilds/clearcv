import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseCVText } from '../src/structured-import.js';
import { validateDocument, plainTextDocument } from '../src/model.js';

const retainedSource = result => result.document.hiddenSections.map(id => result.document.customSections.find(section => section.id === id).content).join('');
const withoutIds = items => items.map(({ id, ...item }) => item);

test('maps a complete practical CV into existing fields without rewriting achievements', () => {
  const text = `Alex Morgan
Senior Product Designer
alex@example.com · +44 7700 900000 · Bristol, UK · https://alex.design

Professional Summary
I create accessible tools for independent businesses.

WORK EXPERIENCE
Senior Product Designer | Northstar Studio | Bristol | Jan 2022 – Present
• Built a design system used by four teams.
Product Designer
Fieldwork
London
2019 — 2022
• Tested prototypes with 40 customers.

EDUCATION
BA (Hons) Design
University of the West of England
2016 — 2019
First-class honours.

TECHNICAL SKILLS
Figma, User research, Prototyping

PROJECTS
Built an open-source reading tracker.`;
  const result = analyseCVText(text, { idPrefix: 'alex' }), doc = result.document;
  assert.deepEqual(doc.profile, {
    name: 'Alex Morgan', headline: 'Senior Product Designer', email: 'alex@example.com', phone: '+44 7700 900000',
    location: 'Bristol, UK', website: 'https://alex.design', summary: 'I create accessible tools for independent businesses.'
  });
  assert.deepEqual(withoutIds(doc.experience), [
    { title: 'Senior Product Designer', organisation: 'Northstar Studio', location: 'Bristol', dates: 'Jan 2022 – Present', description: 'Built a design system used by four teams.' },
    { title: 'Product Designer', organisation: 'Fieldwork', location: 'London', dates: '2019 — 2022', description: 'Tested prototypes with 40 customers.' }
  ]);
  assert.deepEqual(withoutIds(doc.education), [{ title: 'BA (Hons) Design', organisation: 'University of the West of England', location: '', dates: '2016 — 2019', description: 'First-class honours.' }]);
  assert.deepEqual(doc.skills.map(item => item.name), ['Figma', 'User research', 'Prototyping']);
  assert.equal(doc.customSections.find(section => section.title === 'PROJECTS').content, 'Built an open-source reading tracker.');
  assert.equal(retainedSource(result), text);
  assert.equal(result.unmappedText, '');
  assert.deepEqual(doc, validateDocument(doc));
  assert.deepEqual(result.detectedSections.map(section => section.kind), ['profile', 'summary', 'experience', 'education', 'skills', 'custom']);
  assert.match(plainTextDocument(doc), /Built a design system used by four teams\./);
  assert.doesNotMatch(plainTextDocument(doc), /Imported source/);
});

test('date-first blocks, company-first headers and single education years preserve supplied dates', () => {
  const result = analyseCVText(`Priya Shah
Software Engineer
Email: priya@example.com
Employment history
2022 - Present
Senior Software Engineer
ACME CORP
• Led platform migration.
2018 - 2022
BETA INC
Software Engineer
• Built APIs.
Education
Example University
BSc Computer Science | 2018
• Dissertation on accessible APIs.`);
  assert.deepEqual(withoutIds(result.document.experience), [
    { title: 'Senior Software Engineer', organisation: 'ACME CORP', location: '', dates: '2022 - Present', description: 'Led platform migration.' },
    { title: 'Software Engineer', organisation: 'BETA INC', location: '', dates: '2018 - 2022', description: 'Built APIs.' }
  ]);
  assert.equal(result.document.education[0].title, 'BSc Computer Science');
  assert.equal(result.document.education[0].organisation, 'Example University');
  assert.equal(result.document.education[0].dates, '2018');
  assert.equal(result.document.education[0].description, 'Dissertation on accessible APIs.');
});

test('Unicode, contact columns, tabbed work columns and categorised skills remain structured', () => {
  const text = `Ana María O’Neill | UX Researcher | ana@example.org
+353 87 123 4567 · Dublin, Ireland
Skills: Research; Français; C++
Programming languages: Python, SQL
• .NET
Selected Projects
Community archive — 2021
Expérience professionnelle
Researcher\tExample Institute\tDublin\t2020 – Present
✓ Conducted 12 interviews.`;
  const result = analyseCVText(text);
  assert.equal(result.document.profile.name, 'Ana María O’Neill');
  assert.equal(result.document.profile.headline, 'UX Researcher');
  assert.equal(result.document.profile.email, 'ana@example.org');
  assert.equal(result.document.profile.phone, '+353 87 123 4567');
  assert.equal(result.document.profile.location, 'Dublin, Ireland');
  assert.deepEqual(result.document.skills.map(item => item.name), ['Research', 'Français', 'C++', 'Python', 'SQL', '.NET']);
  assert.deepEqual(withoutIds(result.document.experience), [{ title: 'Researcher', organisation: 'Example Institute', location: 'Dublin', dates: '2020 – Present', description: 'Conducted 12 interviews.' }]);
  assert.equal(retainedSource(result), text);
});

test('combined title/company separators and split heading extraction do not invent facts', () => {
  const result = analyseCVText(`Name: Sam Li
Headline: Data Analyst
Location: Manchester
WORK
EXPERIENCE
Data Analyst at Atlas Ltd (Sep 2019 to Dec 2021)
• Reduced errors by 17%.
Senior Analyst @ Signal Ltd — Jan 2022 - Current
• Maintained an existing reporting tool.
EDUCATION
MSc Statistics — Example University — 2017 – 2018
SKILLS & EXPERTISE
SQL | R | Python`);
  assert.deepEqual(result.document.experience.map(item => [item.title, item.organisation, item.dates]), [
    ['Data Analyst', 'Atlas Ltd', 'Sep 2019 to Dec 2021'], ['Senior Analyst', 'Signal Ltd', 'Jan 2022 - Current']
  ]);
  assert.equal(result.document.experience[0].description, 'Reduced errors by 17%.');
  assert.deepEqual(result.document.education.map(item => [item.title, item.organisation, item.dates]), [['MSc Statistics', 'Example University', '2017 – 2018']]);
  assert.equal(result.document.profile.location, 'Manchester');
  assert.equal(result.document.coverLetter.body, '');
  assert.equal(result.document.jobAd, '');
});

test('ambiguous career text stays reviewable rather than creating a fictitious employer or achievement', () => {
  const text = `Alex Morgan
Experience
Several years around engineering teams, but details are missing.
Unclear dates and role order

EXPERIMENTAL PRACTICE
Some unrelated notes.
Skills
Python`;
  const result = analyseCVText(text);
  assert.equal(result.document.experience.length, 0);
  assert.match(result.unmappedText, /Several years around engineering teams/);
  assert.match(result.unmappedText, /Unclear dates and role order/);
  assert.ok(result.document.customSections.some(section => /review required/.test(section.title)));
  assert.ok(result.document.customSections.some(section => section.title === 'EXPERIMENTAL PRACTICE' && section.content === 'Some unrelated notes.'));
  assert.ok(result.warnings.some(warning => /needs your help/.test(warning)));
  assert.equal(retainedSource(result), text);
  assert.doesNotMatch(plainTextDocument(result.document), /Acme|increased|reduced|20\d\d/i);
});

test('additional contact facts and unrecognised header details remain in unmapped text', () => {
  const text = `Alex Morgan
Engineer
Email: alex@example.org
Email: other@example.org
Website: https://alex.example.org
Website: https://other.example.org
Nationality: British
Skills
SQL`;
  const result = analyseCVText(text);
  assert.equal(result.document.profile.email, 'alex@example.org');
  assert.equal(result.document.profile.website, 'https://alex.example.org');
  assert.match(result.unmappedText, /other@example\.org/);
  assert.match(result.unmappedText, /https:\/\/other\.example\.org/);
  assert.match(result.unmappedText, /Nationality: British/);
  assert.ok(result.warnings.some(warning => /More than one email/.test(warning)));
  assert.equal(retainedSource(result), text);
});

test('source preservation includes whitespace, original bullets, markup and line-ending normalisation', () => {
  const original = '  Alex Morgan\r\nEngineer\r\n\r\nSkills\r\n • C++\t SQL  \r\n\r\nProjects\r<script>alert("x")</script>  \r\n';
  const result = analyseCVText(original);
  const expected = original.replace(/\r\n?/g, '\n');
  assert.equal(result.sourceText, expected);
  assert.equal(retainedSource(result), expected);
  assert.equal(result.document.profile.name, 'Alex Morgan');
  assert.match(result.document.customSections.find(section => section.title === 'Projects').content, /<script>/);
  assert.ok(result.document.hiddenSections.every(id => result.document.sectionOrder.includes(id)));
});

test('large Unicode source chunks are complete, valid and no longer than the model limit', () => {
  const text = `Projects\n${'é'.repeat(29_990)}🪴${'界'.repeat(19_995)}`;
  assert.ok(text.length <= 50_000);
  const result = analyseCVText(text, { idPrefix: 'large' });
  assert.equal(retainedSource(result), text);
  assert.equal(result.document.hiddenSections.length, 2);
  assert.ok(result.document.customSections.every(section => section.content.length <= 30_000));
  assert.deepEqual(result.document, validateDocument(result.document));
  assert.ok(result.warnings.some(warning => /split into editable sections/.test(warning)));
});

test('field and description limits preserve omitted material with an explicit warning', () => {
  const oversizedHeadline = 'x'.repeat(301), oversizedSummary = 'S'.repeat(10_001), oversizedDescription = 'D'.repeat(10_001);
  const text = `Name: Alex Morgan\nHeadline: ${oversizedHeadline}\nSummary\n${oversizedSummary}\nExperience\nEngineer | Acme Ltd | 2020 – Present\n• ${oversizedDescription}`;
  const result = analyseCVText(text);
  assert.equal(result.document.profile.headline, '');
  assert.equal(result.document.profile.summary, '');
  assert.equal(result.document.experience[0].description, '');
  for (const value of [oversizedHeadline, oversizedSummary, oversizedDescription]) assert.ok(result.unmappedText.includes(value));
  assert.ok(result.warnings.some(warning => /Profile headline exceeds 300/.test(warning)));
  assert.ok(result.warnings.some(warning => /summary exceeds 10,000/.test(warning)));
  assert.ok(result.warnings.some(warning => /description exceeds 10,000/.test(warning)));
  assert.equal(retainedSource(result), text);
  assert.deepEqual(result.document, validateDocument(result.document));
});

test('item limits and excessive custom sections leave overflow complete and reviewable', () => {
  const entries = Array.from({ length: 61 }, (_, index) => `Engineer | Company ${index} | 2020 – Present\n• Built tool ${index}.`).join('\n');
  const skills = Array.from({ length: 61 }, (_, index) => `Skill ${index}`).join(', ');
  const extras = Array.from({ length: 22 }, (_, index) => `\n\nEXTRA SECTION ${String.fromCharCode(65 + index)}:\nFact ${index}`).join('');
  const text = `Alex Morgan\nExperience\n${entries}\nSkills\n${skills}\nProjects\nExisting project${extras}`;
  const result = analyseCVText(text);
  assert.equal(result.document.experience.length, 60);
  assert.equal(result.document.skills.length, 60);
  assert.equal(result.document.customSections.length, 20);
  assert.match(result.unmappedText, /Company 60/);
  assert.match(result.unmappedText, /Skill 60/);
  assert.match(result.unmappedText, /Fact 21/);
  assert.ok(result.warnings.some(warning => /60 experience/.test(warning)));
  assert.ok(result.warnings.some(warning => /60 skills/.test(warning)));
  assert.ok(result.warnings.some(warning => /More custom sections/.test(warning)));
  assert.equal(retainedSource(result), text);
  assert.deepEqual(result.document, validateDocument(result.document));
});

test('repeated analysis is deterministic and independent of mutations to a previous proposal', () => {
  const text = 'Alex Morgan\nEngineer\nSkills: Python, SQL';
  const first = analyseCVText(text, { idPrefix: 'same' }), reference = structuredClone(first);
  first.document.profile.name = 'Changed';
  first.document.skills[0].name = 'Changed';
  first.document.customSections[0].content = 'Changed';
  first.detectedSections[0].lines[0] = 'Changed';
  first.warnings.push('Changed');
  assert.deepEqual(analyseCVText(text, { idPrefix: 'same' }), reference);
  assert.equal(text, 'Alex Morgan\nEngineer\nSkills: Python, SQL');
  assert.ok([...reference.document.experience, ...reference.document.education, ...reference.document.skills, ...reference.document.customSections].every(item => /^[a-zA-Z0-9_-]{1,80}$/.test(item.id)));
});

test('ordinary documentary notices never displace the supplied identity and remain exact in source and unmapped text', () => {
  const notices = ['  PRIVATE AND CONFIDENTIAL  ', 'Private & confidential', 'Page One of Two', 'Page 1/2 · Confidential', 'Document for review · no personal data'];
  const source = `${notices.join('\n')}\nMorgan Ellis\nProduct designer\nmorgan@example.com\nSkills\nResearch`;
  const result = analyseCVText(source);
  assert.equal(result.document.profile.name, 'Morgan Ellis');
  assert.equal(result.document.profile.headline, 'Product designer');
  assert.equal(result.document.profile.location, '');
  assert.equal(retainedSource(result), source);
  for (const notice of notices) assert.ok(result.unmappedText.includes(notice));
  assert.ok(result.warnings.some(warning => /confidentiality notices/.test(warning)));
});

test('multiple plausible unlabelled identities are disclosed without guessing or shifting names into other fields', () => {
  const source = 'Morgan Ellis\nJamie Harper\nProduct designer\nmorgan@example.com\nSkills\nResearch';
  const result = analyseCVText(source);
  assert.equal(result.document.profile.name, '');
  assert.equal(result.document.profile.headline, 'Product designer');
  assert.equal(result.document.profile.location, '');
  assert.ok(result.unmappedText.includes('Morgan Ellis'));
  assert.ok(result.unmappedText.includes('Jamie Harper'));
  assert.ok(result.warnings.some(warning => /More than one possible name/.test(warning)));
  assert.equal(retainedSource(result), source);
});

test('explicit labelled identity takes priority while a separate plausible person remains reviewable', () => {
  const source = 'Confidential\nJamie Harper\nName: İpek de la Cruz\nProfessional title: Software engineer\nSkills\nJavaScript';
  const result = analyseCVText(source);
  assert.equal(result.document.profile.name, 'İpek de la Cruz');
  assert.equal(result.document.profile.headline, 'Software engineer');
  assert.equal(result.document.profile.location, '');
  assert.ok(result.unmappedText.includes('Jamie Harper'));
  assert.ok(result.warnings.some(warning => /additional possible name/.test(warning)));
  assert.equal(retainedSource(result), source);
});

test('mononyms, Unicode names, particles and documentary-looking surnames are preserved as supplied', () => {
  for (const name of ['Ayo', '李明', 'İpek de la Cruz', 'van der Meer', 'Page Turner', 'Faith Hope']) {
    const source = `${name}\nSoftware engineer\nSkills\nJavaScript`;
    const result = analyseCVText(source);
    assert.equal(result.document.profile.name, name);
    assert.equal(result.document.profile.headline, 'Software engineer');
    assert.equal(retainedSource(result), source);
  }
  const labelled = analyseCVText('Name: Private Hope\nProfessional title: Software engineer\nSkills\nJavaScript');
  assert.equal(labelled.document.profile.name, 'Private Hope');
});

test('identity is never inferred from an email and later name-like header facts stay uncertain', () => {
  const emailOnly = analyseCVText('Contact\nsomebody_else@example.com\nSkills\nJavaScript');
  assert.equal(emailOnly.document.profile.name, '');
  assert.equal(emailOnly.document.profile.email, 'somebody_else@example.com');
  const source = 'Morgan Ellis\nProduct designer\nJamie Harper\nSkills\nResearch';
  const result = analyseCVText(source);
  assert.equal(result.document.profile.name, 'Morgan Ellis');
  assert.equal(result.document.profile.headline, 'Product designer');
  assert.equal(result.document.profile.location, '');
  assert.ok(result.unmappedText.includes('Jamie Harper'));
  assert.ok(result.warnings.some(warning => /extra heading/.test(warning)));
  assert.equal(retainedSource(result), source);
});

test('rejects excessive input, damaged text and invalid identifier prefixes before producing a proposal', () => {
  for (const input of [null, 12, {}, [], new String('Alex')]) assert.throws(() => analyseCVText(input), /text CV/);
  for (const input of ['', ' \n\t', '\u200B', '\uFEFF']) assert.throws(() => analyseCVText(input), /no readable/);
  assert.throws(() => analyseCVText('x'.repeat(50_001)), /50,000/);
  for (const input of ['Alex\0Morgan', 'Alex\u0001Morgan', 'Alex\uFFFFMorgan', 'Alex\uD800Morgan', 'Alex\uDC00Morgan']) assert.throws(() => analyseCVText(input), /damaged or non-text/);
  for (const idPrefix of ['', 'x'.repeat(49), 'unsafe/id', 'λ', null, 4]) assert.throws(() => analyseCVText('Alex Morgan', { idPrefix }), /ID prefix/);
  assert.deepEqual(analyseCVText('x'.repeat(50_000)).document, validateDocument(analyseCVText('x'.repeat(50_000)).document));
});
