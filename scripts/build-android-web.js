const fs=require('fs');
const path=require('path');
const esbuild=require('esbuild');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'dist','android');
const files=['index.html','styles.css','welcome.css','content.js','app.js','welcome.js','storage.js','analytics.js','manifest.json','sw.js'];

function copyFile(rel){
  const src=path.join(ROOT,rel), dst=path.join(OUT,rel);
  fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.copyFileSync(src,dst);
}
function copyDir(src,dst){
  fs.mkdirSync(dst,{recursive:true});
  for(const e of fs.readdirSync(src,{withFileTypes:true})){
    const a=path.join(src,e.name), b=path.join(dst,e.name);
    e.isDirectory()?copyDir(a,b):fs.copyFileSync(a,b);
  }
}

fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true});
files.forEach(copyFile); copyDir(path.join(ROOT,'assets'),path.join(OUT,'assets'));
fs.copyFileSync(path.join(ROOT,'scripts','android-boot.js'),path.join(OUT,'android-boot.js'));

esbuild.buildSync({
  entryPoints:[path.join(ROOT,'scripts','android-native-entry.js')],
  bundle:true, format:'iife', platform:'browser', target:['chrome120'],
  outfile:path.join(OUT,'android-native.js'), minify:true
});

let html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
html=html.replace(/\s*<!-- Yandex\.Metrika counter -->[\s\S]*?<!-- \/Yandex\.Metrika counter -->\s*/,'\n');
html=html.replace(/\s*<noscript><div><img src="https:\/\/mc\.yandex\.ru\/watch\/112756217"[\s\S]*?<\/noscript>\s*/,'\n');
html=html.replace(/\s*<script src="content\.js[^"]*"><\/script>[\s\S]*?<script src="welcome\.js[^"]*"><\/script>\s*/,
  '\n  <script src="android-native.js"></script>\n  <script src="content.js?v=20260918g"></script>\n  <script src="analytics.js?v=20260918h"></script>\n  <script src="storage.js?v=20260918h"></script>\n  <script src="android-boot.js?v=20260918h"></script>\n');
if(/mc\.yandex\.ru|\bym\s*\(/.test(html)) throw new Error('Yandex Metrika leaked into Android build');
fs.writeFileSync(path.join(OUT,'index.html'),html);

const required=['index.html','styles.css','welcome.css','content.js','app.js','welcome.js','storage.js','analytics.js','android-native.js','android-boot.js','assets/kopihvost-splash.webp','assets/onboarding-1.webp','assets/onboarding-2.webp','assets/onboarding-3.webp','assets/onboarding-4.webp','assets/objects.webp','assets/extras.webp','assets/worlds.webp'];
for(const rel of required) if(!fs.existsSync(path.join(OUT,rel))) throw new Error('Missing Android asset: '+rel);
console.log('Android web bundle ready:',OUT);
