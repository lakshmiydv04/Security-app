# Installs the Android SDK pieces guardian-mobile needs, and nothing else.
# Safe to re-run: every step is skipped if it is already done.
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # without this, Invoke-WebRequest is ~10x slower

$SdkRoot   = 'D:\Android\Sdk'
$ZipName   = 'commandlinetools-win-15859902_latest.zip'
$ZipUrl    = "https://dl.google.com/android/repository/$ZipName"
$ExpectSha = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
$ZipPath   = Join-Path (Join-Path $env:USERPROFILE 'Downloads') $ZipName

Write-Host ''
Write-Host '=== Android SDK setup for guardian-mobile ===' -ForegroundColor Cyan

# --- 0. Java (sdkmanager is a JVM tool; Gradle already proved a JDK exists) -----
$java = $null
if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\java.exe")) { $java = "$env:JAVA_HOME\bin\java.exe" }
elseif (Get-Command java -ErrorAction SilentlyContinue)            { $java = (Get-Command java).Source }
if (-not $java) { throw 'No Java found. Set JAVA_HOME, or put java.exe on PATH, then re-run.' }
Write-Host "  Java: $java"

# --- 1. Download (reuses the file if it is already in Downloads) ---------------
if (Test-Path $ZipPath) {
  Write-Host "  Reusing existing download: $ZipName"
} else {
  Write-Host "  Downloading $ZipName (~156 MB). This takes a few minutes..."
  Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
}

# --- 2. Verify it before trusting it ------------------------------------------
Write-Host '  Verifying checksum...'
$sha = (Get-FileHash $ZipPath -Algorithm SHA256).Hash.ToLower()
if ($sha -ne $ExpectSha) {
  throw "Checksum mismatch.`n  got:      $sha`n  expected: $ExpectSha`nDelete $ZipPath and re-run."
}
Write-Host '  Checksum OK.' -ForegroundColor Green

# --- 3. Extract into the exact layout sdkmanager demands ----------------------
# The zip holds a top-level 'cmdline-tools' folder; its CONTENTS must end up in
# <sdk>\cmdline-tools\latest\. Getting this wrong is the usual failure.
$Latest = Join-Path $SdkRoot 'cmdline-tools\latest'
if (Test-Path (Join-Path $Latest 'bin\sdkmanager.bat')) {
  Write-Host '  cmdline-tools already in place.'
} else {
  Write-Host '  Extracting...'
  $tmp = Join-Path $env:TEMP ('cmdlinetools-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp    | Out-Null
  Expand-Archive -Path $ZipPath -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path $Latest | Out-Null
  Get-ChildItem (Join-Path $tmp 'cmdline-tools') -Force | Move-Item -Destination $Latest -Force
  Remove-Item $tmp -Recurse -Force
}
$sdkm = Join-Path $Latest 'bin\sdkmanager.bat'
if (-not (Test-Path $sdkm)) { throw "sdkmanager.bat missing at $sdkm - extraction shape is wrong." }

# --- 4. Install exactly the three packages this project needs -----------------
# compileSdk 35 / buildTools 35.0.0 come from android/build.gradle.
# No NDK or CMake: the app module compiles no C++.
Write-Host '  Installing platform-tools, platforms;android-35, build-tools;35.0.0 ...'
& $sdkm "--sdk_root=$SdkRoot" 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'
if ($LASTEXITCODE -ne 0) { throw "sdkmanager install failed (exit $LASTEXITCODE)." }

# --- 5. Licences (Gradle fails confusingly if these are unaccepted) -----------
Write-Host '  Accepting SDK licences...'
((1..40 | ForEach-Object { 'y' }) -join "`r`n") | & $sdkm "--sdk_root=$SdkRoot" '--licenses' | Out-Null

# --- 6. ANDROID_HOME, so the React Native CLI can find adb --------------------
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $SdkRoot, 'User')
$env:ANDROID_HOME = $SdkRoot
Write-Host "  ANDROID_HOME set to $SdkRoot (User scope)."

# --- 7. Prove it actually worked ----------------------------------------------
Write-Host ''
Write-Host '=== Verification ===' -ForegroundColor Cyan
$ok = $true
foreach ($p in @("$SdkRoot\platform-tools\adb.exe",
                 "$SdkRoot\platforms\android-35",
                 "$SdkRoot\build-tools\35.0.0")) {
  if (Test-Path $p) { Write-Host "  OK      $p" -ForegroundColor Green }
  else              { Write-Host "  MISSING $p" -ForegroundColor Red; $ok = $false }
}
if ($ok) {
  & "$SdkRoot\platform-tools\adb.exe" version
  Write-Host ''
  Write-Host 'SDK install complete.' -ForegroundColor Green
  Write-Host 'Now CLOSE this terminal, open a new one, and run:  npm run android'
} else {
  throw 'Some SDK components are missing - see above.'
}
