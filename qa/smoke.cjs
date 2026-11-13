/* Run from any directory: node /workspace/minha-rodagem-v2/qa/smoke.cjs
 * Requires a runtime that permits Chromium IPC.
 * APP_URL tests a published copy in isolated browser storage; otherwise a
 * loopback server serves the checkout at a GitHub Pages style subpath.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const report = { mode: 'Real Chromium through Playwright', passed: [], errors: [], browserErrors: [] };
let server, browser, page;
const key = 'minha-rodagem-v1';
const money = value => String(value).replace(/\s/g, '');
const check = async (name, fn) => {
  await fn();
  report.passed.push(name);
  console.log('PASS', name);
};
const readRecords = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)).registros, key);
const waitRecords = (page, count) => page.waitForFunction(({key,count}) => JSON.parse(localStorage.getItem(key) || '{"registros":[]}').registros.length === count, {key,count});
const fill = async (page, form, values) => {
  for (const [name, value] of Object.entries(values)) {
    const field = page.locator(`#${form} [name="${name}"]`);
    if (await field.evaluate(el => el.tagName === 'SELECT')) await field.selectOption(String(value));
    else await field.fill(String(value));
  }
};
async function navigate(page, panel) {
  await page.locator(`.main-nav [data-panel="${panel}"]`).click();
  await page.locator(`#${panel}`).waitFor({ state: 'visible' });
  assert.equal(await page.locator(`.view:not([hidden])`).count(), 1);
  assert.equal(new URL(page.url()).hash, '#' + panel);
}
async function acceptConfirmation(page) {
  const dialog = page.locator('#confirmacao');
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('button[value="confirmar"]').click();
  await dialog.waitFor({ state: 'hidden' });
}

(async () => {
  for (const file of ['index.html', 'styles.css', 'app.js', 'experience.js', 'sw.js']) {
    await fs.access(path.join(root, file));
  }
  await fs.mkdir(__dirname, { recursive: true });
  let base = process.env.APP_URL;
  if (!base) {
    server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (!pathname.startsWith('/meu-primeiro-app/')) { res.writeHead(404).end(); return; }
      const rel = pathname.slice('/meu-primeiro-app/'.length) || 'index.html';
      const target = path.resolve(root, rel);
      if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      const body = await fs.readFile(target);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/meu-primeiro-app/`;
  }
  const parsedBase = new URL(base);
  if (!['http:', 'https:'].includes(parsedBase.protocol)) throw Error('APP_URL must be HTTP(S)');
  report.appURL = base;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.env.CI ? undefined : '/usr/bin/chromium'), headless: true,
    args: ['--no-sandbox', '--disable-crashpad-for-testing', '--disable-breakpad'] });
  report.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  page = await context.newPage();
  page.on('pageerror', err => report.browserErrors.push(err.message));
  await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') });
  await page.goto(base);

  await check('five routes, hashes and browser back', async () => {
    for (const panel of ['inicio', 'fechamento', 'consumo', 'historico', 'ajustes']) await navigate(page, panel);
    await page.goBack();
    await page.locator('#historico').waitFor({ state: 'visible' });
  });
  await check('320/390/1280 layouts have no horizontal overflow', async () => {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: width > 500 ? 960 : 844 });
      for (const panel of ['inicio', 'fechamento', 'consumo', 'historico', 'ajustes']) {
        await navigate(page, panel);
        const sizes = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(sizes.document <= sizes.viewport + 1, `${panel} at ${width}px overflows: ${JSON.stringify(sizes)}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check('v1 records load without migration or loss', async () => {
    await page.evaluate(({ key, fixture }) => localStorage.setItem(key, JSON.stringify({ versao: 1, registros: [fixture] })), {
      key,
      fixture: { id: 'legacy-day', tipo: 'dia', data: '2026-11-13', ganhos: 18000, combustivel: 2500, outros: 500, entregas: 20, horas: 600, km: 12000 }
    });
    await page.reload();
    await navigate(page, 'inicio');
    assert.equal(money(await page.locator('#saldo-hoje').innerText()), 'R$150,00');
    assert.equal((await readRecords(page))[0].id, 'legacy-day');
  });
  await check('routine presets, editable profile and goal persist', async () => {
    await navigate(page, 'ajustes');
    await page.locator('[data-rotina="6"]').click();
    assert.equal(await page.locator('#perfil [name="jornada"]').inputValue(), '6');
    await fill(page, 'perfil', { nome: 'Gustavo', meta: '200', modelo: 'Minha CG 160', combustivel: 'Gasolina' });
    await page.locator('#perfil button[type="submit"]').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('minha-rodagem-perfil-v2') || '{}').nome === 'Gustavo');
    await page.reload();
    await navigate(page, 'ajustes');
    assert.equal(await page.locator('#perfil [name="nome"]').inputValue(), 'Gustavo');
    assert.equal(await page.locator('#perfil [name="jornada"]').inputValue(), '6');
    await navigate(page, 'inicio');
    assert.ok((await page.locator('#titulo-inicio').innerText()).includes('Gustavo'));
    assert.ok((await page.locator('#meta-texto').innerText()).includes('50'));
  });
  let savedDayId;
  await check('daily live balance, save and history edit preserve legacy records', async () => {
    await navigate(page, 'fechamento');
    await fill(page, 'dia', { data: '2026-11-12', ganhos: '180,00', entregas: '20', combustivel: '20,00', outros: '10,00' });
    await page.locator('[data-horas="6"]').click();
    assert.equal(await page.locator('#dia [name="horas"]').inputValue(), '6');
    assert.equal(money(await page.locator('#previa-saldo').innerText()), 'R$150,00');
    await page.locator('#dia button[value="salvar"]').click();
    await waitRecords(page, 2);
    let records = await readRecords(page);
    assert.equal(records.length, 2);
    const record = records.find(r => r.id !== 'legacy-day');
    savedDayId = record.id;
    assert.equal(record.ganhos - record.combustivel - record.outros, 15000);
    await navigate(page, 'historico');
    const entry = page.locator('#lista article').filter({ hasText: '12/11/2026' });
    await entry.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.locator('#fechamento').waitFor({ state: 'visible' });
    await fill(page, 'dia', { ganhos: '200,00' });
    await page.locator('#dia button[value="salvar"]').click();
    await page.waitForFunction(id => JSON.parse(localStorage.getItem('minha-rodagem-v1')).registros.find(r => r.id === id)?.ganhos === 20000, savedDayId);
    records = await readRecords(page);
    assert.equal(records.length, 2);
    assert.equal(records.find(r => r.id === savedDayId).ganhos, 20000);
    assert.ok(records.some(r => r.id === 'legacy-day'));
  });
  await check('invalid numbers and canceled duplicate day never create records', async () => {
    await navigate(page, 'fechamento');
    const count = (await readRecords(page)).length;
    await fill(page, 'dia', { data: '2026-11-13', ganhos: '-10', entregas: '1' });
    assert.equal((await page.locator('#previa-saldo').innerText()).trim(), '—');
    await page.locator('#dia button[value="salvar"]').click();
    assert.equal((await readRecords(page)).length, count);
    assert.equal(await page.locator('#mensagem').getAttribute('data-error'), 'true');
    await fill(page, 'dia', { ganhos: '100', entregas: '1,5' });
    await page.locator('#dia button[value="salvar"]').click();
    assert.equal((await readRecords(page)).length, count);
    await fill(page, 'dia', { ganhos: '100', entregas: '10' });
    await page.locator('#dia button[value="salvar"]').click();
    await page.locator('#confirmacao').waitFor({ state: 'visible' });
    await page.locator('#confirmacao button[value="cancelar"]').click();
    assert.equal((await readRecords(page)).length, count);
    await page.reload();
  });
  await check('full/partial/full fuel cycle and dashboard data connect', async () => {
    await navigate(page, 'consumo');
    let fuelCount = (await readRecords(page)).length;
    for (const values of [
      { odometro: '65.000', litros: '5', valor: '30', tanque: 'cheio' },
      { odometro: '65.150', litros: '4', valor: '24', tanque: 'parcial' },
      { odometro: '65.300', litros: '6', valor: '36', tanque: 'cheio' }
    ]) {
      await fill(page, 'posto', { data: '2026-11-13', ...values });
      await page.locator('#posto button[value="salvar"]').click();
      await waitRecords(page, ++fuelCount);
    }
    assert.ok((await page.locator('#resultado-posto').innerText()).includes('30 km/L'));
    assert.ok((await page.locator('#moto-consumo').innerText()).includes('30'));
    assert.equal(money(await page.locator('#moto-custo').innerText()), 'R$0,20');
    assert.equal((await readRecords(page)).length, 5);
    await fill(page, 'posto', { data: '2026-11-13', odometro: '65.300', litros: '3', valor: '18', tanque: 'cheio' });
    await page.locator('#posto button[value="salvar"]').click();
    assert.equal((await readRecords(page)).length, 5, 'duplicate odometer must be rejected');
    await navigate(page, 'inicio');
    assert.equal(money(await page.locator('#saldo-hoje').innerText()), 'R$150,00', 'pump purchases must not double-subtract daily expenses');
  });
  await check('fuel estimate rounds an exact half-cent up in real form interactions', async () => {
    const isolated = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 390, height: 844 } });
    try {
      const rounding = await isolated.newPage();
      rounding.on('pageerror', err => report.browserErrors.push(err.message));
      await rounding.clock.install({ time: new Date('2026-11-13T12:00:00Z') });
      await rounding.goto(base);
      await navigate(rounding, 'consumo');
      let count = 0;
      for (const values of [{odometro:'1000',litros:'10',valor:'50'}, {odometro:'1200',litros:'10',valor:'35'}]) {
        await fill(rounding, 'posto', {data:'2026-11-13',tanque:'cheio',...values});
        await rounding.locator('#posto button[value="salvar"]').click();
        await waitRecords(rounding, ++count);
      }
      await navigate(rounding, 'fechamento');
      await fill(rounding, 'dia', {data:'2026-11-13',km:'1'});
      await rounding.locator('#estimar').click();
      await rounding.waitForFunction(() => document.querySelector('#dia [name="combustivel"]').value === '0,18');
      assert.equal(await rounding.locator('#dia [name="combustivel"]').inputValue(), '0,18');
    } finally { await isolated.close(); }
  });
  await check('backup downloads, invalid backup preserves records, valid import refreshes views', async () => {
    await navigate(page, 'historico');
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#backup').click();
    const download = await downloadEvent;
    const target = path.join(__dirname, 'backup-test.json');
    await download.saveAs(target);
    const backup = JSON.parse(await fs.readFile(target, 'utf8'));
    assert.equal(backup.versao, 1);
    assert.equal(backup.registros.length, 5);
    const original = await readRecords(page);
    await page.locator('#arquivo').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"versao":9,"registros":[]}') });
    await page.waitForFunction(() => document.querySelector('#mensagem').dataset.error === 'true');
    assert.deepEqual(await readRecords(page), original);
    const extra = { ...backup.registros.find(r => r.tipo === 'dia'), id: 'restored-extra', data: '2026-11-11' };
    await page.locator('#arquivo').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...backup, registros: [...backup.registros, extra] })) });
    await acceptConfirmation(page);
    await waitRecords(page, 6);
    assert.equal((await readRecords(page)).length, 6);
    assert.ok((await page.locator('#lista').innerText()).includes('11/11/2026'));
  });
  let finalCount = 6;
  await check('journey timer excludes pauses, survives reload, prefills and clears only after saving', async () => {
    await navigate(page, 'inicio');
    await page.locator('#jornada-iniciar').click();
    await page.clock.fastForward(2 * 60 * 60 * 1000);
    await page.locator('#jornada-pausar').click();
    const paused = await page.locator('#jornada-tempo').innerText();
    await page.clock.fastForward(30 * 60 * 1000);
    assert.equal(await page.locator('#jornada-tempo').innerText(), paused);
    await page.reload();
    await page.locator('#jornada-pausar').click();
    await page.clock.fastForward(30 * 60 * 1000);
    const before = (await readRecords(page)).length;
    await page.locator('#jornada-encerrar').click();
    await page.locator('#fechamento').waitFor({ state: 'visible' });
    const hours = Number((await page.locator('#dia [name="horas"]').inputValue()).replace(',', '.'));
    assert.ok(Math.abs(hours - 2.5) < .02, `Expected 2.5 hours, got ${hours}`);
    assert.equal((await readRecords(page)).length, before, 'finish must not auto-save financial data');
    await page.reload();
    await navigate(page, 'inicio');
    assert.ok(!(await page.locator('#jornada-status').innerText()).includes('Não iniciada'), 'pending session should survive reload until financial save');
    await page.locator('#jornada-iniciar').click();
    await page.locator('#fechamento').waitFor({ state: 'visible' });
    await fill(page, 'dia', { ganhos: '100', entregas: '10' });
    await page.locator('#dia button[value="salvar"]').click();
    await acceptConfirmation(page);
    finalCount = before + 1;
    await waitRecords(page, finalCount);
    assert.equal((await readRecords(page)).length, finalCount);
    await page.waitForFunction(() => localStorage.getItem('minha-rodagem-jornada-v2') === null);
    assert.equal(await page.evaluate(() => localStorage.getItem('minha-rodagem-jornada-v2')), null, 'successful associated closing clears pending shift');
    await navigate(page, 'inicio');
    assert.ok((await page.locator('#jornada-status').innerText()).includes('Não iniciada'));
  });
  await check('a stale tab cannot overwrite records saved in another tab', async () => {
    const second = await context.newPage();
    second.on('pageerror', err => report.browserErrors.push(err.message));
    await second.clock.install({ time: new Date('2026-11-13T12:00:00Z') });
    await second.goto(base);
    await navigate(second, 'fechamento');
    await fill(second, 'dia', { data: '2026-11-10', ganhos: '40', entregas: '4' });
    await second.locator('#dia button[value="salvar"]').click();
    finalCount += 1;
    await waitRecords(second, finalCount);
    assert.equal((await readRecords(second)).length, finalCount);
    await navigate(page, 'fechamento');
    await fill(page, 'dia', { data: '2026-11-09', ganhos: '70', entregas: '7' });
    await page.locator('#dia button[value="salvar"]').click();
    await page.waitForFunction(() => {
      const message = document.querySelector('#mensagem');
      return message.dataset.error === 'true' && message.textContent.includes('outra aba');
    });
    assert.equal((await readRecords(page)).length, finalCount, 'stale save must be rejected rather than drop concurrent record');
    assert.ok((await page.locator('#mensagem').innerText()).includes('outra aba'));
    await second.close();
    await page.reload();
  });
  await check('PWA reloads and navigates offline under Pages subpath', async () => {
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigate(page, 'historico');
    assert.equal((await readRecords(page)).length, finalCount);
    await navigate(page, 'inicio');
    assert.ok((await page.locator('#conexao').innerText()).includes('Sem internet'));
    await context.setOffline(false);
  });
  await check('screenshots captured and no JavaScript runtime errors', async () => {
    await navigate(page, 'inicio');
    await page.screenshot({ path: path.join(__dirname, 'mobile-dashboard.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 960 });
    await page.screenshot({ path: path.join(__dirname, 'desktop-dashboard.png'), fullPage: true });
    await navigate(page, 'fechamento');
    await page.screenshot({ path: path.join(__dirname, 'desktop-fechamento.png'), fullPage: true });
    assert.deepEqual(report.browserErrors, []);
  });
})().catch(async error => {
  report.errors.push(error.stack || error.message);
  console.error(error.stack || error);
  if (page && !page.isClosed()) {
    try {
      report.failureState = await page.evaluate(() => ({
        notice: document.querySelector('#mensagem')?.textContent,
        noticeError: document.querySelector('#mensagem')?.dataset.error,
        panel: document.querySelector('.view:not([hidden])')?.id,
        recordCount: JSON.parse(localStorage.getItem('minha-rodagem-v1') || '{"registros":[]}').registros.length,
        url: location.href
      }));
      console.error('FAILURE_STATE', JSON.stringify(report.failureState));
    } catch (diagnosticError) { report.diagnosticError = diagnosticError.message; }
    try { await page.screenshot({ path: path.join(__dirname, 'failure.png'), fullPage: true, timeout: 10000 }); }
    catch (captureError) { report.screenshotError = captureError.message; }
  }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(__dirname, 'report.json'), JSON.stringify(report, null, 2));
  console.log('BROWSER_REPORT', JSON.stringify(report));
});
