const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'dist');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assetDataUri(assetPath) {
  const absolutePath = path.join(root, assetPath);
  if (!fs.existsSync(absolutePath)) return null;
  const extension = path.extname(assetPath).slice(1).toLowerCase();
  const mime = extension === 'svg' ? 'image/svg+xml' : `image/${extension}`;
  const payload = fs.readFileSync(absolutePath).toString('base64');
  return `data:${mime};base64,${payload}`;
}

function inlineAssets(css) {
  return css.replace(/url\((['"]?)(assets\/[^)'"?]+)\1\)/g, (match, quote, assetPath) => {
    const data = assetDataUri(assetPath);
    return data ? `url("${data}")` : match;
  });
}

function inlineScriptAssets(source) {
  return source.replace(/(['"])(assets\/[^'"?]+\.(?:svg|webp|png))\1/g, (match, quote, assetPath) => {
    const data = assetDataUri(assetPath);
    return data ? `${quote}${data}${quote}` : match;
  });
}

function safeScript(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

const original = read('index.html');
const bodyMatch = original.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
if (!bodyMatch) throw new Error('Не найден body в index.html');

const css = inlineAssets(`${read('styles.css')}\n${read('welcome.css')}`);
const content = safeScript(read('content.js'));
const app = safeScript(read('app.js'));
const welcome = safeScript(inlineScriptAssets(read('welcome.js')));
const title = (original.match(/<title>(.*?)<\/title>/i) || [null, 'ФинПитомец'])[1];

const standalone = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#285441">
  <title>${title}</title>
  <style>${css}</style>
</head>
<body>${bodyMatch[1]
  .replace(/<script[^>]+src="content\.js"[^>]*><\/script>/i, `<script>${content}</script>`)
  .replace(/<script[^>]+src="app\.js"[^>]*><\/script>/i, `<script>${app}</script>`)
  .replace(/<script[^>]+src="welcome\.js"[^>]*><\/script>/i, `<script>${welcome}</script>`)}
</body>
</html>`;

fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, 'finpet_demo_v5.html');
fs.writeFileSync(output, standalone);
console.log(`Standalone создан: ${output} (${Math.round(Buffer.byteLength(standalone) / 1024)} КБ)`);
