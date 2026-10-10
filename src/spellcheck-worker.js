/* A classic worker keeps dictionary parsing and suggestions off the UI thread. */
self.onmessage = async event => {
  try {
    const { text, ignored } = event.data;
    if (typeof text !== 'string' || text.length > 50000 || !Array.isArray(ignored)) throw new Error('The dictionary request is too large.');
    const base = new URL('../public/vendor/spellcheck/', self.location.href);
    importScripts(new URL('typo.js', base).href);
    const responses = await Promise.all([fetch(new URL('en_GB.aff', base)), fetch(new URL('en_GB.dic', base))]);
    if (responses.some(response => !response.ok)) throw new Error('The local British English dictionary is unavailable.');
    const [aff, dic] = await Promise.all(responses.map(response => response.text()));
    const dictionary = new Typo('en_GB', aff, dic, { platform: 'any' });
    const exceptions = new Set(ignored.map(word => word.toLocaleLowerCase('en-GB'))), seen = new Set();
    const issues = [];
    let checkedWords = 0, limitReached = false, suggested = 0;
    for (const match of text.matchAll(/\p{L}+(?:['’\-]\p{L}+)*/gu)) {
      const word = match[0]; if (word.length > 40 || word.length < 2) continue;
      if (++checkedWords > 4000) { checkedWords = 4000; limitReached = true; break; }
      const lower = word.toLocaleLowerCase('en-GB');
      if (exceptions.has(lower) || dictionary.check(word) || dictionary.check(lower) || seen.has(lower)) continue;
      seen.add(lower);
      if (issues.length >= 60) { limitReached = true; break; }
      const suggestions = suggested++ < 10 ? dictionary.suggest(word, 5).filter(value => value.length <= 80).slice(0, 5) : [];
      issues.push({ word, start: match.index, end: match.index + word.length, suggestions });
    }
    self.postMessage({ issues, checkedWords, limitReached });
  } catch (error) { self.postMessage({ error: error.message }); }
};
