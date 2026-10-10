export const MAX_SPELL_TEXT = 50_000;
export function checkText(text, { signal, ignored = [] } = {}) {
  if (typeof text !== 'string' || text.length > MAX_SPELL_TEXT) return Promise.reject(new Error('Check at most 50,000 characters at a time.'));
  if (!Array.isArray(ignored) || ignored.length > 500 || ignored.some(word => typeof word !== 'string' || word.length > 40)) return Promise.reject(new Error('You can accept up to 500 short words per session. Clear the list before adding more.'));
  if (signal?.aborted) return Promise.reject(new DOMException('Spelling check cancelled.', 'AbortError'));
  if (!text.trim()) return Promise.resolve({ issues: [], checkedWords: 0, limitReached: false });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./spellcheck-worker.js', import.meta.url));
    let finished = false;
    const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); error ? reject(error) : resolve(value); };
    const abort = () => finish(new DOMException('Spelling check cancelled.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('The spelling check took longer than 30 seconds. Check a shorter section.')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => {
      const result = event.data;
      if (!result || !Array.isArray(result.issues) || typeof result.checkedWords !== 'number' || result.issues.length > 60) { finish(new Error(result?.error || 'The spelling check returned an invalid result. Try checking again.')); return; }
      if (result.issues.some(issue => typeof issue.word !== 'string' || !Number.isInteger(issue.start) || !Number.isInteger(issue.end) || issue.start < 0 || issue.end > text.length || text.slice(issue.start, issue.end) !== issue.word || !Array.isArray(issue.suggestions) || issue.suggestions.some(word => typeof word !== 'string' || word.length > 80))) { finish(new Error('The spelling result no longer matches the text. Check again.')); return; }
      finish(null, result);
    };
    worker.onerror = () => finish(new Error('The spelling dictionary couldn’t load. Reload the page, or restart ClearCV if you’re running it locally.'));
    worker.postMessage({ text, ignored });
  });
}
