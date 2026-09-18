const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
function update(file,fn){
  const full=path.join(ROOT,file); if(!fs.existsSync(full)) throw new Error('Missing '+file);
  const before=fs.readFileSync(full,'utf8'), after=fn(before);
  if(after!==before){fs.writeFileSync(full,after); console.log('Updated:',file);} else console.log('No change:',file);
}
update('android/variables.gradle',s=>s.replace(/minSdkVersion\s*=\s*\d+/,'minSdkVersion = 26'));
update('android/app/build.gradle',s=>s.replace(/versionCode\s+\d+/,'versionCode 1').replace(/versionName\s+"[^"]+"/,'versionName "0.1.0"'));
update('android/app/src/main/AndroidManifest.xml',s=>{
  s=s.replace(/\s*<uses-permission android:name="android\.permission\.INTERNET"\s*\/>\s*/g,'\n');
  s=s.replace(/android:allowBackup="true"/g,'android:allowBackup="false"');
  if(!/android:usesCleartextTraffic="false"/.test(s)) s=s.replace(/(<application\b)/,'$1\n        android:usesCleartextTraffic="false"');
  if(!/android:screenOrientation="portrait"/.test(s)) s=s.replace(/(<activity\b[\s\S]*?android:name="\.MainActivity"[^>]*)(>)/,'$1 android:screenOrientation="portrait"$2');
  return s;
});
const manifest=fs.readFileSync(path.join(ROOT,'android/app/src/main/AndroidManifest.xml'),'utf8');
if(/android\.permission\.INTERNET/.test(manifest)) throw new Error('INTERNET permission remains in Android manifest');
if(!/android:screenOrientation="portrait"/.test(manifest)) throw new Error('portrait orientation missing');
if(/android:allowBackup="true"/.test(manifest)) throw new Error('Android cloud backup must stay disabled');
if(!/android:usesCleartextTraffic="false"/.test(manifest)) throw new Error('cleartext traffic guard missing');
console.log('Android native configuration verified');
