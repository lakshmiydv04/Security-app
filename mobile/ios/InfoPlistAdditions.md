# iOS configuration

`scripts/bootstrap.mjs` applies these to the generated `ios/GuardianMobile/Info.plist`.
They are listed here so the intent is reviewable rather than buried in a script.

## Background modes

```xml
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
  <string>voip</string>
</array>
```

`location` keeps location updates flowing when backgrounded. `voip` keeps the
command socket alive for check-in requests.

`audio` is deliberately **not** included. It would let the app capture in the
background without the call-style treatment, which is precisely the covert
capture this product exists to prevent. Microphone check-ins are foreground
only on iOS, and that is a product decision, not a platform limitation to work
around later.

## Usage descriptions

iOS shows these verbatim at the permission prompt, so they are written as
promises the app actually keeps:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Shares your location with the guardian you connected to. You can switch this off at any time.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Shares your location with the guardian you connected to, including when the app is in the background. You can switch this off at any time.</string>

<key>NSCameraUsageDescription</key>
<string>Lets your guardian request a camera check-in, and lets you scan a pairing code. Your screen shows a red banner whenever the camera is live.</string>

<key>NSMicrophoneUsageDescription</key>
<string>Lets your guardian request an audio check-in. Your screen shows a red banner whenever the microphone is live.</string>
```

## What must never be added

- Any entitlement or API used to draw over the system status bar. The
  OS-rendered orange and green indicators are the guarantee a modified build
  cannot remove.
- `NSLocationAlwaysUsageDescription` without the visible in-app disclosure
  this app already renders.
