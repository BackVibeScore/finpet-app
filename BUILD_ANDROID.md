# Android build — КопиХвост

Android-версия — Capacitor-оболочка существующего HTML/CSS/JS приложения. Игровая логика не дублируется.

## Требования
- Node.js 22+
- JDK 21
- Android SDK
- npm

## Сборка
```bash
npm install
npm run android:apk
```
Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

Параметры: applicationId `ru.kopihvost.app`, versionName `0.1.0`, versionCode `1`, minSdk 26, portrait. Android cloud backup и cleartext traffic отключены; прогресс остаётся локальным.

## Offline и аналитика
Все runtime-файлы и изображения находятся внутри APK. Android-сборка не зависит от Vercel или service worker.
Яндекс.Метрика удаляется из Android `index.html` на этапе сборки. AppMetrica пока не подключена.

## Сохранения
Ключ совместимости остаётся `finpet_mvp_state_v1`.
На Android Capacitor Preferences хранит основной долговременный state, а `localStorage` остаётся синхронным mirror-слоем для существующей логики.
Порядок восстановления: native current → native backup → старый localStorage → новый профиль.
Резервный ключ: `finpet_mvp_state_v1_backup`.

Удаление приложения или Android → «Очистить данные» удалит локальный прогресс. Restart, force stop, reboot и обновление APK поверх той же applicationId — не должны.

## Проверка обновления
1. Установить v1, создать профиль и изменить прогресс.
2. Force stop и повторный запуск.
3. Перезагрузить устройство и проверить прогресс.
4. Увеличить versionCode, собрать v2 и выполнить `adb install -r app-debug.apk`.
5. Проверить профиль.

## Release signing
Создайте keystore вне репозитория:
```bash
keytool -genkeypair -v -keystore kopihvost-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias kopihvost
```
Не коммитьте `.jks`, `.keystore`, пароли или signing properties. Используйте локальные Gradle properties или CI secrets.

## AppMetrica
Точка расширения: `window.FINPET_ANALYTICS.event(name, params)`. Сейчас Android adapter no-op; позже сюда подключается AppMetrica.

Release unsigned APK собирается командой `cd android && ./gradlew assembleRelease` и появляется в `android/app/build/outputs/apk/release/app-release-unsigned.apk`.
