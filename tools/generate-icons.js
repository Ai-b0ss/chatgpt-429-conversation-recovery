const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

async function generateIcons() {
  const rootDir = path.resolve(__dirname, '..');
  const svgPath = path.join(rootDir, 'extension', 'icons', 'icon.svg');
  const iconsDir = path.join(rootDir, 'extension', 'icons');
  
  if (!fs.existsSync(svgPath)) {
    throw new Error(`SVG file not found at ${svgPath}`);
  }
  
  const svgContent = fs.readFileSync(svgPath, 'utf8');
  const sizes = [16, 32, 48, 128];
  
  const browser = await chromium.launch({ headless: true });
  try {
    for (const size of sizes) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1
      });
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html, body {
              width: ${size}px;
              height: ${size}px;
              overflow: hidden;
              background: transparent;
            }
            svg {
              width: 100%;
              height: 100%;
              display: block;
            }
          </style>
        </head>
        <body>
          ${svgContent}
        </body>
        </html>
      `;
      
      await page.setContent(html);
      const outPath = path.join(iconsDir, `icon-${size}.png`);
      await page.screenshot({
        path: outPath,
        omitBackground: true,
        type: 'png'
      });
      
      console.log(`Generated ${outPath} (${size}x${size}, ${fs.statSync(outPath).size} bytes)`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

generateIcons().catch(err => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
