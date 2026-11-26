const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { chromium } = require('./playwright_runtime.cjs');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const fromFrontend = createRequire(path.join(frontend, 'package.json'));
const out = path.join(root, 'tmp/shell-layout');
const sourceMode = process.argv.includes('--source');
const base = process.env.DEMO_TEST_BASE || 'http://127.0.0.1:8011';
assert.equal(new URL(base).hostname, '127.0.0.1');
const checks = [], errors = [], measurements = [], blockedRequests = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); };

async function settleLayout(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // A wheel event can still be scrolling after a resize or same-document navigation.
    // Wait for stable layout across frames before asking the compositor for a screenshot.
    await new Promise((resolve, reject) => {
      const started = performance.now();
      let last = '', stableSince = started;
      const sample = () => {
        const header = document.querySelector('.topbar')?.getBoundingClientRect();
        const state = JSON.stringify([scrollX, scrollY, innerWidth, innerHeight,
          document.documentElement.scrollHeight, header?.top, header?.height,
          visualViewport?.offsetTop, visualViewport?.height]);
        const now = performance.now();
        if (state !== last) { last = state; stableSince = now; }
        if (now - stableSince >= 200) return resolve();
        if (now - started > 5000) return reject(new Error('Shell layout did not settle'));
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });
}

// Isolated source mode exercises the real shell without a build or a dev server.
// Browser request interception serves in-memory TSX transforms and installed React.
async function sourceHarness(page) {
  const { transformWithOxc } = await import(pathToFileURL(fromFrontend.resolve('vite')).href);
  const packageFile = (name, file) => path.join(path.dirname(fromFrontend.resolve(name)), 'cjs', file);
  const modules = {
    react: packageFile('react', 'react.production.js'),
    'react/jsx-runtime': packageFile('react', 'react-jsx-runtime.production.js'),
    'react-dom': packageFile('react-dom', 'react-dom.production.js'),
    'react-dom/client': packageFile('react-dom', 'react-dom-client.production.js'),
    scheduler: packageFile('scheduler', 'scheduler.production.js'),
    'lucide-react': fromFrontend.resolve('lucide-react'),
  };
  const sources = Object.fromEntries(Object.entries(modules).map(([name, file]) => [name, fs.readFileSync(file, 'utf8')]));
  const cssFiles = ['app/workspace.css', 'app/hierarchy.css', 'features/analytics/analytics.css'];
  const main = fs.readFileSync(path.join(frontend, 'src/main.tsx'), 'utf8');
  for (const [, file] of main.matchAll(/import '\.\/([^']+\.css)'/g)) cssFiles.push(file);
  const css = cssFiles.map(file => fs.readFileSync(path.join(frontend, 'src', file), 'utf8')).join('\n');
  const imports = Object.fromEntries(Object.keys(modules).map(name => [name, '/__shell_source/package/' + name]));
  const entry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import AppShell from '/__shell_source/app/AppShell.tsx';
    function Fixture() {
      const [route, setRoute] = useState('analytics');
      window.shellNavigate = target => { setRoute(target); window.scrollTo(0, 0); };
      return React.createElement(AppShell, {
        route, go: target => { window.shellLastRoute = target; window.shellNavigate(target); },
        pending: 12, openDialog: name => { window.shellLastDialog = name; }
      }, React.createElement('section', { className: 'panel' },
        React.createElement('h2', null, '布局验收样例'),
        React.createElement('p', null, '此区域仅用于 shell 滚动与定位验收。'),
        React.createElement('div', { className: 'analytics-toolbar' }, '效果与复盘'),
        React.createElement('div', { style: { height: 1600 } })
      ));
    }
    createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `;
  await page.route('**/__shell_source/**', async request => {
    try {
      const pathname = new URL(request.request().url()).pathname;
      let code;
      if (pathname.startsWith('/__shell_source/package/')) {
        const name = pathname.slice('/__shell_source/package/'.length);
        assert.ok(modules[name]);
        const names = Object.keys(fromFrontend(name)).filter(key => /^[a-zA-Z_$][\w$]*$/.test(key) && key !== 'default');
        code = `const pkg = window.shellRequire(${JSON.stringify(name)}); export default pkg;\n` +
          names.map(key => `export const ${key} = pkg.${key};`).join('\n');
      } else {
        const relative = pathname.slice('/__shell_source/'.length);
        if (relative.endsWith('.css')) code = '';
        else {
          assert.ok(relative.startsWith('app/') && !relative.includes('..'));
          let filename = path.join(frontend, 'src', relative);
          if (!path.extname(filename)) filename += fs.existsSync(filename + '.tsx') ? '.tsx' : '.ts';
          code = (await transformWithOxc(fs.readFileSync(filename, 'utf8'), filename, { jsx: { runtime: 'automatic' } })).code;
        }
      }
      await request.fulfill({ contentType: 'text/javascript', body: code });
    } catch (error) {
      errors.push(error.message);
      await request.abort();
    }
  });
  await page.route('**/__shell_layout', async request => {
    await request.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' });
  });
  await page.goto(base + '/__shell_layout');
  await page.addStyleTag({ content: css });
  await page.evaluate(sources => {
    const cache = {};
    window.shellRequire = name => {
      if (cache[name]) return cache[name].exports;
      if (!sources[name]) throw new Error('Unexpected browser dependency: ' + name);
      const module = cache[name] = { exports: {} };
      new Function('require', 'module', 'exports', 'process', sources[name])(
        window.shellRequire, module, module.exports, { env: { NODE_ENV: 'production' } });
      return module.exports;
    };
  }, sources);
  await page.addScriptTag({ type: 'importmap', content: JSON.stringify({ imports }) });
  await page.addScriptTag({ type: 'module', content: entry });
}

async function geometry(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.workspace-frame');
    const style = getComputedStyle(frame);
    const rect = selector => {
      const element = document.querySelector(selector);
      const r = element?.getBoundingClientRect();
      return r ? { top: r.top, left: r.left, right: r.right, bottom: r.bottom, height: r.height } : null;
    };
    return {
      scrollY,
      header: rect('.topbar'), sidebar: rect('.workspace-sidebar'), main: rect('.main-shell'),
      tabs: rect('.module-navigation'), heading: rect('.page-heading'),
      headerHeight: parseFloat(style.getPropertyValue('--shell-header-height')),
      tabsHeight: parseFloat(style.getPropertyValue('--shell-tabs-height')),
      headerPosition: getComputedStyle(document.querySelector('.topbar')).position,
      sidebarPosition: getComputedStyle(document.querySelector('.workspace-sidebar')).position,
      mainOffset: parseFloat(getComputedStyle(document.querySelector('.main-shell')).paddingTop),
      toolbarTop: document.querySelector('.analytics-toolbar')
        ? parseFloat(getComputedStyle(document.querySelector('.analytics-toolbar')).top) : null,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      clippedLabels: [...document.querySelectorAll('.module-navigation button,.breadcrumb button,.breadcrumb-segment > span')]
        .some(element => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1),
    };
  });
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.origin !== new URL(base).origin ||
        /\/api\/.*(?:generate|model\/check|completion)/i.test(url.pathname)) {
      blockedRequests.push({ method: request.method(), path: url.pathname });
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const navigate = async route => {
    if (sourceMode) await page.evaluate(route => window.shellNavigate(route), route);
    else await page.goto(base + '/#/' + route);
    await page.locator('.page-heading h1').waitFor();
    await settleLayout(page);
  };
  try {
    if (sourceMode) await sourceHarness(page);
    else await page.goto(base + '/#/analytics');
    await page.locator('.workspace-nav-group').first().waitFor();
    check('six grouped primary entries', await page.locator('.workspace-primary-nav .nav-item').count() === 6);
    check('three navigation groups', await page.locator('.workspace-nav-group').count() === 3);
    for (const width of [1440, 1024, 761, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await navigate('analytics');
        await page.getByRole('button', { name: theme === 'light' ? '浅色主题' : '深色主题', exact: true }).click();
        await settleLayout(page);
        const before = await geometry(page);
        measurements.push({ width, theme, ...before });
        check(`${width}/${theme} fixed topbar and sidebar`, before.headerPosition === 'fixed' && before.sidebarPosition === 'fixed');
        check(`${width}/${theme} header aligned with sidebar`, Math.abs(before.header.left - (width > 760 ? before.sidebar.right : 0)) < 1);
        check(`${width}/${theme} sidebar spans viewport`, before.sidebar.height === 900);
        check(`${width}/${theme} measured header offsets content`, Math.abs(before.mainOffset - before.header.height) < 1 && before.heading.top - before.main.top >= before.header.height);
        check(`${width}/${theme} complete labels and no horizontal overflow`, !before.overflow && !before.clippedLabels);
        check(`${width}/${theme} analytics sticky offset`, Math.abs(before.toolbarTop - before.headerHeight - before.tabsHeight) < 1);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await settleLayout(page);
        check(`${width}/${theme} top screenshot starts at document top`, await page.evaluate(() => scrollY === 0));
        if ([1440, 390, 320].includes(width)) await page.screenshot({ path: path.join(out, `${sourceMode ? 'source' : 'served'}-${width}-${theme}-top.png`), animations: 'disabled' });
        await page.evaluate(() => window.scrollTo(0, 420));
        await settleLayout(page);
        const after = await geometry(page);
        check(`${width}/${theme} viewport anchors survive scrolling`, after.header.top === 0 && after.sidebar.top === 0);
        check(`${width}/${theme} secondary tabs stick under topbar`, Math.abs(after.tabs.top - after.header.bottom) < 1);
        check(`${width}/${theme} tab observer is current`, Math.abs(after.tabs.height - after.tabsHeight) < 1);
        if ([1440, 390, 320].includes(width)) await page.screenshot({ path: path.join(out, `${sourceMode ? 'source' : 'served'}-${width}-${theme}.png`), animations: 'disabled' });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate('product');
    const detail = page.locator('.breadcrumb [aria-current=page]');
    check('mobile detail context stays visible', await detail.innerText() === '商品资料' && await detail.isVisible());
    const normalHeight = (await geometry(page)).headerHeight;
    await page.locator('.topbar').evaluate(element => element.style.paddingBottom = '50px');
    await page.waitForFunction(height => parseFloat(getComputedStyle(document.querySelector('.workspace-frame')).getPropertyValue('--shell-header-height')) > height, normalHeight);
    const enlarged = await geometry(page);
    check('header observer updates content after height changes', enlarged.headerHeight > normalHeight && Math.abs(enlarged.mainOffset - enlarged.header.height) < 1);
    await page.locator('.topbar').evaluate(element => element.style.removeProperty('padding-bottom'));
    await page.waitForFunction(height => Math.abs(parseFloat(getComputedStyle(document.querySelector('.workspace-frame')).getPropertyValue('--shell-header-height')) - height) < 1, normalHeight);
    await settleLayout(page);
    await page.screenshot({ path: path.join(out, 'mobile-detail-context.png'), animations: 'disabled' });
    check('website remains reachable on mobile', await page.getByRole('link', { name: '产品官网' }).isVisible());
    await page.getByRole('button', { name: '打开主导航', exact: true }).click();
    check('drawer opens with inert background', await page.locator('.main-shell').evaluate(element => element.inert));
    check('drawer receives focus', await page.locator('.workspace-sidebar').evaluate(element => element.contains(document.activeElement)));
    await page.getByRole('button', { name: '帮助', exact: true }).focus();
    await page.keyboard.press('Tab');
    check('drawer traps forward focus', await page.locator('.workspace-brand').evaluate(element => element === document.activeElement));
    await page.keyboard.press('Shift+Tab');
    check('drawer traps reverse focus', await page.getByRole('button', { name: '帮助', exact: true }).evaluate(element => element === document.activeElement));
    await page.screenshot({ path: path.join(out, 'mobile-drawer.png') });
    await page.keyboard.press('Escape');
    check('escape restores toggle focus', await page.getByRole('button', { name: '打开主导航' }).evaluate(element => element === document.activeElement));
    check('escape unlocks background', await page.locator('.main-shell').evaluate(element => !element.inert) && await page.evaluate(() => document.body.style.overflow !== 'hidden'));
    await page.getByRole('button', { name: '打开主导航' }).click();
    await page.locator('.workspace-primary-nav .nav-item').first().click();
    check('mobile navigation closes drawer', await page.locator('.workspace-sidebar.is-open').count() === 0);
    await page.getByRole('button', { name: '打开主导航' }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    check('settings closes drawer', await page.locator('.workspace-sidebar.is-open').count() === 0);
    if (sourceMode) check('settings callback preserved', await page.evaluate(() => window.shellLastDialog === 'settings'));
    else {
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
    await page.getByRole('button', { name: '打开主导航' }).click();
    await page.setViewportSize({ width: 1024, height: 360 });
    await page.waitForFunction(() => !document.querySelector('.main-shell').inert);
    check('desktop resize clears drawer state', await page.locator('.workspace-sidebar.is-open').count() === 0);
    check('short viewport keeps utilities visible', await page.getByRole('button', { name: '帮助', exact: true }).boundingBox().then(box => box.y + box.height <= 360));
    check('short viewport scrolls business navigation', await page.locator('.workspace-primary-nav').evaluate(element => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto'));
    await page.setViewportSize({ width: 1440, height: 900 });
    const routes = ['overview', 'geo', 'live?pane=session', 'creative?view=campaigns', 'product?tab=catalog', 'agent'];
    for (let index = 0; index < routes.length; index++) {
      await page.locator('.workspace-primary-nav .nav-item').nth(index).click();
      const actual = sourceMode ? await page.evaluate(() => window.shellLastRoute) : new URL(page.url()).hash.slice(2);
      check(`primary route ${routes[index]}`, actual === routes[index]);
    }
    await page.getByRole('button', { name: '浅色主题', exact: true }).click();
    await page.locator('.workspace-primary-nav .nav-item').first().click();
    check('pointer selection has no extra outline or inset ring', await page.locator('.workspace-primary-nav .active').evaluate(element => getComputedStyle(element).outlineStyle === 'none' && getComputedStyle(element).boxShadow === 'none'));
    await page.keyboard.press('Tab');
    check('keyboard focus remains visible', await page.evaluate(() => document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle !== 'none'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    check('reduced motion disables transitions', await page.locator('.workspace-primary-nav .nav-item').first().evaluate(element => getComputedStyle(element).transitionDuration === '0s'));
    if (!sourceMode) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await navigate('product');
      await page.locator('.product-editor').waitFor();
      await page.getByRole('button', { name: '查看关联素材', exact: true }).click();
      await page.locator('.studio-library').waitFor();
      await page.mouse.wheel(0, 900);
      await settleLayout(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await navigate('product');
      await page.getByLabel('商品名称', { exact: true }).waitFor();
      await settleLayout(page);
      const productBeforeReload = await geometry(page);
      measurements.push({ scenario: 'product-after-materials-resize', ...productBeforeReload });
      check('served product header remains fixed after materials resize', productBeforeReload.header.top === 0 && productBeforeReload.headerPosition === 'fixed');
      check('served product context remains hit-testable', await page.locator('.topbar').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.left + 30, rect.top + 28));
      }));
      await page.screenshot({ path: path.join(out, 'served-product-mobile-resize.png'), animations: 'disabled' });
      await page.evaluate(() => window.scrollTo({ top: 350, behavior: 'instant' }));
      await settleLayout(page);
      const scrollBeforeReload = await page.evaluate(() => scrollY);
      check('served product header stays fixed while scrolled', scrollBeforeReload > 0 && (await geometry(page)).header.top === 0);
      await page.reload();
      await page.getByLabel('商品名称', { exact: true }).waitFor();
      await settleLayout(page);
      const productAfterReload = await geometry(page);
      measurements.push({ scenario: 'product-mobile-reload', scrollBeforeReload, ...productAfterReload });
      // Reload restoration belongs to the navigation layer; shell geometry must hold at either position.
      check('served product header survives reload from a scrolled page', productAfterReload.header.top === 0 && productAfterReload.headerPosition === 'fixed');
      check('served product content offset is independent of restored scroll', Math.abs(productAfterReload.mainOffset - productAfterReload.header.height) < 1 && productAfterReload.heading.top - productAfterReload.main.top >= productAfterReload.header.height);
      check('served product remains vertically scrollable without horizontal overflow', !productAfterReload.overflow && await page.evaluate(() => document.documentElement.scrollHeight > innerHeight));
      await page.screenshot({ path: path.join(out, 'served-product-mobile-reload.png'), animations: 'disabled' });
    }
    await page.evaluate(() => document.body.dataset.printReport = 'true');
    await page.emulateMedia({ media: 'print' });
    check('report printing removes fixed header offset', await page.locator('.main-shell').evaluate(element => getComputedStyle(element).paddingTop === '0px'));
    check('no uncaught browser errors', errors.length === 0);
    check('no write or model requests attempted', blockedRequests.length === 0);
    console.log(JSON.stringify({ mode: sourceMode ? 'isolated-source' : 'served-app', passed: checks.length, output: out }));
  } catch (error) {
    await page.screenshot({ path: path.join(out, 'failure.png') });
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, sourceMode ? 'source-result.json' : 'result.json'), JSON.stringify({ mode: sourceMode ? 'isolated-source' : 'served-app', checks, errors, measurements, blockedRequests }, null, 2));
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
