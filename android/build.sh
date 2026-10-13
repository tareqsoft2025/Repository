#!/usr/bin/env bash
# يبني hr.apk بأدوات حزم Ubuntu: aapt apksigner zipalign libandroid-23-java dalvik-exchange
# الاستخدام: android/build.sh  → يُنتج app/hr.apk (التوقيع بمفتاح android/hr.keystore إن وُجد وإلا يُنشأ)
set -euo pipefail
cd "$(dirname "$0")"
OUT=build; rm -rf $OUT; mkdir -p $OUT/classes $OUT/gen
AJ=/usr/lib/android-sdk/platforms/android-23/android.jar
aapt package -f -m -J $OUT/gen -M AndroidManifest.xml -S res -I $AJ -F $OUT/unsigned.apk
javac --release 8 -encoding UTF-8 -cp $AJ -d $OUT/classes $(find src $OUT/gen -name '*.java') 2>&1 | grep -v "^warning\|^Note\|bootstrap" || true
java -cp /usr/share/java/com.android.dx.jar com.android.dx.command.Main --dex --min-sdk-version=21 --output=$OUT/classes.dex $OUT/classes
(cd $OUT && aapt add unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 $OUT/unsigned.apk $OUT/aligned.apk
[ -f hr.keystore ] || keytool -genkeypair -keystore hr.keystore -storepass hrstore123 -keypass hrstore123 -alias hr -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=HR System, O=tareqsoft, C=PS" 2>/dev/null
mkdir -p ../app; rm -f ../app/hr.apk.idsig
apksigner sign --ks hr.keystore --ks-pass pass:hrstore123 --key-pass pass:hrstore123 --out ../app/hr.apk $OUT/aligned.apk
apksigner verify --verbose ../app/hr.apk | head -5
ls -l ../app/hr.apk
