/* Read-only acceptance against the built site. No business records or model calls. */
const { chromium } = require('./playwright_runtime.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.WEBSITE_TEST_URL || 'http://127.0.0.1:8000';
const out = path.resolve('tmp/website-verification');

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const checks = [], errors = [], failedResources = [], mutations = [];
  const record = (name, value) => { assert.ok(value, name); checks.push(name); console.log('PASS ' + name); };
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failedResources.push([response.url(), response.status()]); });
  page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') mutations.push(request.url()); });
  const visit = () => page.goto(base + '/website.html', { waitUntil: 'networkidle' });
  const canvas = () => page.locator('.qy-particle-field').evaluate(element => element.toDataURL());
  const tab = name => page.getByRole('tab', { name: new RegExp(name) });
  async function scrollThrough() {
    const height = await page.locator('body').evaluate(element => element.scrollHeight);
    for (let y = 0; y < height; y += 550) {
      await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), y);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(150);
  }
  try {
    const response = await visit();
    record('独立官网返回 HTML，品牌名正确', response.status() === 200 && (await page.title()).includes('Qianyan Intelligence'));
    record('官网没有加载工作台样式', await page.locator('link[href*="workspace-"]').count() === 0);
    record('首屏只有一个标题，并说明产品定位', await page.locator('h1').count() === 1 && (await page.locator('h1').innerText()).replace(/\s/g, '').includes('增长工作台'));
    record('首屏直接展示八项功能', await page.locator('#home .qy-module').count() === 8);
    record('已移除重复的理念区块与流程链路', await page.locator('#approach, .qy-connection-line').count() === 0);
    record('品牌标志已显示', await page.locator('.qy-brand svg').first().isVisible());
    record('没有粒子形态切换栏', await page.locator('.qy-scene-controls').count() === 0 && await page.getByRole('button', { name: /粒子形态/ }).count() === 0);
    await page.waitForTimeout(200);
    const firstFrame = await canvas();
    await page.waitForTimeout(250);
    record('粒子背景确实在绘制动画', firstFrame !== await canvas());
    const firstScene = await page.locator('.qy-particle-field').getAttribute('data-scene');
    await page.waitForFunction(first => document.querySelector('.qy-particle-field').dataset.scene !== first, firstScene, { timeout: 12000 });
    record('背景形态无需任何操作，自动变化', true);
    await page.getByRole('button', { name: '暂停背景动效', exact: true }).click();
    const pausedFrame = await canvas();
    await page.waitForTimeout(260);
    record('暂停背景后画面保持静止', pausedFrame === await canvas());
    await page.getByRole('button', { name: '播放背景动效', exact: true }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, 'desktop-hero.png') });

    await page.getByRole('link', { name: '探索产品流程', exact: true }).click();
    await tab('商品资料').waitFor();
    record('首屏入口定位到流程章节', new URL(page.url()).hash === '#journey');
    record('提供六个可访问的流程标签', await page.getByRole('tab').count() === 6);
    await tab('AI 创意').click();
    await page.getByRole('button', { name: '轻装出行', exact: true }).click();
    record('创意方向切换更新正文', (await page.locator('.qy-copy-paper').innerText()).includes('把日常装进行囊'));
    await tab('内容核对').click();
    record('事实核对示例标出三处问题', await page.locator('.qy-review-copy mark').count() === 3);
    await page.getByRole('button', { name: '查看建议文案', exact: true }).click();
    record('查看修订显示准确规格并移除无依据承诺', (await page.locator('.qy-review-copy').innerText()).includes('99 元') && (await page.locator('.qy-review-copy').innerText()).includes('500 ml') && !(await page.locator('.qy-review-copy').innerText()).includes('24'));
    await page.getByRole('button', { name: '对比原始示例' }).click();
    record('可返回原始文案进行对比', await page.locator('.qy-review-copy mark').count() === 3);
    await tab('广告投流').click();
    await page.getByRole('button', { name: '¥240', exact: true }).click();
    record('预算选择同步计算七天预算', (await page.locator('.qy-plan-total').innerText()).includes('¥1680'));
    await tab('成交追踪').click();
    record('成交展示四个关联节点并说明归因边界', await page.locator('.qy-trace-path>div').count() === 4 && (await page.locator('.qy-trace-preview').innerText()).includes('不等同于广告平台归因'));
    await tab('优化复盘').click();
    await page.getByRole('button', { name: '查看优化草稿' }).click();
    record('优化建议可展开新草稿，明确待人工确认', (await page.locator('.qy-insight-card').innerText()).includes('新草稿 → 待人工确认'));
    await tab('优化复盘').focus();
    await page.keyboard.press('Home');
    record('键盘 Home 返回第一流程并更新焦点', await tab('商品资料').getAttribute('aria-selected') === 'true' && await tab('商品资料').evaluate(element => element === document.activeElement));
    await page.keyboard.press('ArrowRight');
    record('方向键可以切换流程标签', await tab('AI 创意').getAttribute('aria-selected') === 'true');
    await tab('商品资料').click();

    const moduleLinks = await page.locator('.qy-module').evaluateAll(elements => elements.map(element => ({ href: element.getAttribute('href'), title: element.querySelector('h3').textContent })));
    record('官网包含原有八个功能入口', moduleLinks.length === 8);
    record('已删除四处多余副标题', await page.evaluate(() => ['点击步骤，体验产品逻辑', '六个环节，一条连续的工作流', '每一步，都为下一步留下依据', '一个虚构保温杯案例，串起完整链路'].every(text => !document.body.innerText.includes(text))));
    await page.locator('.qy-difference-intro').scrollIntoViewIfNeeded();
    const orbitState = () => page.evaluate(() => {
      const box = document.querySelector('.qy-proof-orbit').getBoundingClientRect();
      const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      const m = new DOMMatrix(getComputedStyle(document.querySelector('.qy-proof-ring-one')).transform);
      return { ring: Math.atan2(m.b, m.a), words: [...document.querySelectorAll('.qy-proof-tag')].map(el => { const b = el.getBoundingClientRect(); return Math.atan2(b.top + b.height / 2 - cy, b.left + b.width / 2 - cx); }) };
    });
    const orbitBefore = await orbitState();
    await page.waitForTimeout(1500);
    const orbitAfter = await orbitState();
    record('“有灵感，也有来路”的圆环在转动', orbitBefore.ring !== orbitAfter.ring);
    record('三个词（事实依据、来源追踪、人工确认）绕着中间的星形转动', orbitBefore.words.length === 3 && orbitBefore.words.every((angle, k) => angle !== orbitAfter.words[k]));
    record('中间的星形保持静止', await page.evaluate(() => ['.qy-proof-core', '.qy-proof-core > svg'].every(selector => getComputedStyle(document.querySelector(selector)).animationName === 'none')));
    const robot = page.getByRole('button', { name: '打开项目问答助手' });
    record('右下角有机器人助手，默认收起', await robot.isVisible() && await page.locator('.qy-assistant-panel').count() === 0);
    await robot.click();
    record('点击机器人打开问答窗口并聚焦输入框', await page.getByRole('dialog', { name: /小千/ }).isVisible() && await page.getByLabel('输入你的问题').evaluate(element => element === document.activeElement));
    const askRobot = async question => {
      const before = await page.locator('.qy-msg-bot[data-topic]').count();
      await page.getByLabel('输入你的问题').fill(question);
      await page.getByLabel('输入你的问题').press('Enter');
      await page.waitForFunction(count => document.querySelectorAll('.qy-msg-bot[data-topic]').length > count, before);
      return page.locator('.qy-msg-bot[data-topic]').last().innerText();
    };
    record('助手能回答项目用途', (await askRobot('这个项目是做什么的？')).includes('AI 营销增长工作台'));
    record('助手如实说明广告投放与付款都是模拟', (await askRobot('现在能真实投放广告吗？')).includes('模拟'));
    record('助手用英文提问也能回答', (await askRobot('Which AI model do you use?')).includes('智谱'));
    record('助手对没写到的问题直说答不准', (await askRobot('今天天气怎么样')).includes('答不准'));
    await page.keyboard.press('Escape');
    record('Escape 关闭问答窗口并把焦点还给机器人', await page.locator('.qy-assistant-panel').count() === 0 && await robot.evaluate(element => element === document.activeElement));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const workspace = await browser.newPage();
    workspace.on('pageerror', error => errors.push(error.message));
    for (const item of moduleLinks) {
      await workspace.goto(new URL(item.href, base + '/website.html').href);
      const nav = workspace.getByRole('navigation', { name: '主导航' });
      await nav.waitFor();
      record('进入工作台模块：' + item.title, await nav.getByRole('button', { name: item.title, exact: true }).getAttribute('aria-current') === 'page');
    }
    record('工作台八个入口仍然完整', await workspace.getByRole('navigation', { name: '主导航' }).getByRole('button').count() === 8);
    record('工作台提供官网返回入口', (await workspace.getByRole('link', { name: '产品官网' }).getAttribute('href')) === '/website.html');
    await workspace.goto(base + '/#/overview');
    await workspace.getByRole('navigation', { name: '主导航' }).waitFor();
    record('原首页球体视觉保留', await workspace.locator('.hero-art').count() > 0);
    await workspace.screenshot({ path: path.join(out, 'workspace-preserved.png'), fullPage: true });
    await workspace.close();

    await page.getByText('现在可以真实投放广告、完成付款吗？', { exact: true }).click();
    record('常见问题展开并说明模拟边界', await page.locator('details[open]').count() === 1 && (await page.locator('details[open]').innerText()).includes('不会扣款'));
    await page.getByText('现在可以真实投放广告、完成付款吗？', { exact: true }).click();
    await scrollThrough();
    await page.screenshot({ path: path.join(out, 'desktop-full.png'), fullPage: true });
    record('1440 宽度无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    for (const width of [1280, 768, 375, 320]) {
      await page.setViewportSize({ width, height: width <= 375 ? 812 : 900 });
      await visit();
      await scrollThrough();
      record(width + ' 宽度无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(out, `page-${width}.png`), fullPage: true });
      if (width === 375) await page.screenshot({ path: path.join(out, 'mobile-hero.png') });
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await visit();
    await page.getByRole('button', { name: '展开导航' }).click();
    record('移动端菜单打开', await page.getByRole('navigation', { name: '移动端官网导航' }).isVisible());
    await page.getByRole('navigation', { name: '移动端官网导航' }).getByRole('link', { name: '核心能力' }).click();
    record('移动端导航跳转后关闭', new URL(page.url()).hash === '#capabilities' && !(await page.getByRole('navigation', { name: '移动端官网导航' }).isVisible()));
    await page.getByRole('button', { name: '展开导航' }).click();
    await page.getByRole('navigation', { name: '移动端官网导航' }).getByRole('link').first().focus();
    await page.keyboard.press('Escape');
    record('Escape 关闭菜单并归还焦点', await page.getByRole('button', { name: '展开导航' }).evaluate(element => element === document.activeElement));
    await page.getByRole('button', { name: '展开导航' }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
    record('切换桌面宽度不残留移动端菜单', !(await page.getByRole('navigation', { name: '移动端官网导航' }).isVisible()));

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await visit();
    record('减少动态效果时背景停止', await page.locator('.qy-particle-field').getAttribute('data-motion') === 'paused');
    const reducedFrame = await canvas();
    await page.waitForTimeout(300);
    record('减少动态效果时画面持续静止', reducedFrame === await canvas());
    record('静态模式控件解释系统设置', await page.getByRole('button', { name: '系统已启用减少动态效果' }).isDisabled());
    record('减少动态效果时内容无需等动画显示', await page.locator('[data-reveal]').first().evaluate(element => getComputedStyle(element).opacity === '1'));
    record('减少动态效果时机器人、圆环和三个词都保持静止', await page.evaluate(() => ['.qy-bot-float', '.qy-bot-eye', '.qy-proof-ring-one', '.qy-proof-ring-two', '.qy-proof-carousel', '.qy-proof-slot .qy-proof-tag'].every(selector => getComputedStyle(document.querySelector(selector)).animationName === 'none')));
    await page.screenshot({ path: path.join(out, 'reduced-motion.png') });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(180);
    record('系统动态设置改变后可恢复动效', await page.locator('.qy-particle-field').getAttribute('data-motion') === 'running');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(100);
    record('运行中启用减少动态效果立即停止', await page.locator('.qy-particle-field').getAttribute('data-motion') === 'paused');
    const noScript = await browser.newPage({ javaScriptEnabled: false });
    await noScript.goto(base + '/website.html');
    record('禁用 JavaScript 时仍有品牌说明与工作台入口', await noScript.getByRole('heading', { name: 'Qianyan Intelligence' }).isVisible() && await noScript.getByRole('link', { name: '打开业务 Demo' }).isVisible());
    await noScript.close();
    record('官网交互没有写入业务 API 或调用模型', mutations.length === 0);
    record('无浏览器脚本错误', errors.length === 0);
    record('无失败的网页资源', failedResources.length === 0);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, errors, failedResources, mutations }, null, 2));
    console.log(`Completed ${checks.length} checks.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
