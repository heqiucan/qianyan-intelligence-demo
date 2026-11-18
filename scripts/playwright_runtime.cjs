/* Resolve the pinned frontend development dependency from any working directory.
 * PLAYWRIGHT_MODULE remains an explicit override for bundled local runtimes. */
const path = require('node:path');
const { createRequire } = require('node:module');
const fromFrontend = createRequire(path.resolve(__dirname, '../frontend/package.json'));

try {
  module.exports = process.env.PLAYWRIGHT_MODULE
    ? require(process.env.PLAYWRIGHT_MODULE)
    : fromFrontend('playwright');
} catch (error) {
  throw new Error('找不到 Playwright。请在 frontend 运行 npm ci；如使用其他本地运行时，请显式设置 PLAYWRIGHT_MODULE。', { cause: error });
}
