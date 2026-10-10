import { writeFile } from 'node:fs/promises';

/** Native Preview must leave the CV heading below both sticky mobile controls. */
export async function smokeMobilePreview({ browser, expect, errors, output, resolve, url }) {
  const results = [];
  for (const width of [390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'en-GB' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const settleView = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const headingVisibility = () => page.evaluate(() => {
      const heading = document.querySelector('#cv-preview .cv-name');
      const box = heading.getBoundingClientRect();
      const overlayBottom = Math.max(...['.app-header', '.mobile-view-switch'].map(selector => document.querySelector(selector).getBoundingClientRect().bottom));
      const centre = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { top: box.top, bottom: box.bottom, overlayBottom, viewportHeight: innerHeight, visible: box.top >= overlayBottom && box.bottom <= innerHeight && heading.contains(centre) };
    });
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.locator('#profile-name').fill('Avery Mobile');
      await page.locator('#mobile-preview').click();
      await settleView();
      await expect.poll(async () => (await headingVisibility()).visible, { message: `CV heading clears sticky controls at ${width}px` }).toBe(true);
      const initial = await headingVisibility();
      await page.locator('#mobile-edit').click();
      await settleView();
      await page.locator('#profile-summary').fill('A fictional mobile editing check.');
      const editScroll = await page.evaluate(() => scrollY);
      await page.locator('#mobile-preview').click();
      await settleView();
      await expect.poll(async () => (await headingVisibility()).visible).toBe(true);
      const fromDeepEdit = await headingVisibility();
      await page.screenshot({ path: resolve(output, `mobile-preview-${width}.png`) });
      await page.locator('#mobile-edit').click();
      await settleView();
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(editScroll, 0);
      await page.locator('#mobile-preview').click();
      await settleView();
      await expect.poll(async () => (await headingVisibility()).visible).toBe(true);
      await page.locator('#new-cv').click();
      await settleView();
      await expect(page.locator('#profile-name')).toHaveValue('');
      await expect.poll(() => page.locator('#profile-name').evaluate(input => {
        const box = input.getBoundingClientRect();
        const bottom = Math.max(...['.app-header', '.mobile-view-switch'].map(selector => document.querySelector(selector).getBoundingClientRect().bottom));
        return box.top >= bottom && box.bottom <= innerHeight;
      })).toBe(true);
      results.push({ width, initial, fromDeepEdit, editScroll, newCVInputVisible: true });
    } finally { await context.close(); }
  }
  await writeFile(resolve(output, 'mobile-preview.json'), JSON.stringify({ pass: true, results }, null, 2) + '\n');
}
