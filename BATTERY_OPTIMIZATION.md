# Battery-optimization exemption — how to use it, and the answers to your 3 questions

Two new files, ready to drop in:

- `mobile/src/native/batteryOptimization.ts` — the utility (`openBatteryOptimizationSettings`, `batteryExemptionSupported`).
- `mobile/src/components/BatteryOptimizationCard.tsx` — a themed card with the button.

## 1. Wire it into a screen

Render the card wherever your settings live — the natural home is
`PrivacyControlScreen.tsx` (your main screen), near the connections list:

```tsx
import { BatteryOptimizationCard } from '../components/BatteryOptimizationCard';

// ...somewhere in the screen body:
<BatteryOptimizationCard />
```

It renders nothing on iOS, so no platform guard is needed at the call site. If you'd
rather call the utility from your own button:

```tsx
import { openBatteryOptimizationSettings } from '../native/batteryOptimization';
// await openBatteryOptimizationSettings();  // returns true if a settings screen opened
```

## 2. The intent — safe, and why this one

The utility uses `Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS')`,
which opens the system list of every app's battery-optimization setting. It's wrapped in
try/catch and falls back to `Linking.openSettings()` (the app-details page) on ROMs that
don't expose that action, so it can't crash on a restricted device. No native module, no
new permission.

## 3. Manifest permission — the honest answer

**For this implementation: add nothing.** The settings-list intent needs no permission.

There's a *second*, more aggressive option you referenced — the direct
`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` dialog (the one-tap "Allow?" popup). That one
**does** need:

```xml
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
```

**I'd recommend against it,** and left it out on purpose. Google Play restricts
`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` to a narrow set of app types whose *core function*
provably breaks under Doze; using it outside that set is a common cause of listing
rejection or removal. The settings-screen approach achieves the same outcome (the user
ends up exempting the app) with zero Play risk. Only add the permission + direct dialog if
you've confirmed your listing qualifies — and if you do, gate it behind a native
`PowerManager.isIgnoringBatteryOptimizations()` check so you never show it to a user who's
already exempt (sketch at the bottom).

## Don't forget OEM auto-start (the other half of the problem)

On Xiaomi (MIUI), Oppo/Realme (ColorOS), Vivo (Funtouch) and some others, battery
optimization is **separate** from an "Autostart"/"Auto-launch" permission, and it's often
the autostart screen — not battery optimization — that's actually killing the service.
Those screens are reached via OEM-specific `ComponentName` intents that change between ROM
versions and are genuinely brittle. Rather than ship fragile hardcoded component intents,
the maintainable options are:

- Detect the manufacturer (`react-native-device-info`) and, for known OEMs, add a second
  "Open auto-start settings" button that tries that OEM's intent with the same try/catch +
  `openSettings()` fallback this utility already uses; or
- Show a short, illustrated "for Xiaomi/Oppo users" help note pointing at Settings →
  Apps → Guardian → Autostart.

Say the word and I'll add the OEM auto-start helper with the manufacturer detection.

## Optional: native state-detection + direct dialog (only if your listing qualifies)

If you decide the direct request is justified, this is the Kotlin. It needs registering in
your `ReactPackage` list (in `MainApplication.kt`), which I couldn't read to edit — so this
is a paste, not an applied change:

```kotlin
// BatteryOptimizationModule.kt  (com.guardianmobile)
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.*

class BatteryOptimizationModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {
    override fun getName() = "BatteryOptimization"

    @ReactMethod
    fun isIgnoringOptimizations(promise: Promise) {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        promise.resolve(pm.isIgnoringBatteryOptimizations(ctx.packageName))
    }

    // Requires REQUEST_IGNORE_BATTERY_OPTIMIZATIONS in the manifest, and a
    // Play listing that qualifies for it. Prefer the settings screen otherwise.
    @ReactMethod
    fun requestExemption() {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${ctx.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(intent)
    }
}
```

Then add `BatteryOptimizationModule(reactContext)` to the module list in your existing
`GuardianServicePackage` (or a new package registered in `MainApplication.getPackages()`),
and call `NativeModules.BatteryOptimization.isIgnoringOptimizations()` to only show the card
when the exemption is missing.

---

Nothing here weakens the disclosure model: this only asks the OS to stop killing the
already-visible service, and it's the user tapping through their own system settings.
