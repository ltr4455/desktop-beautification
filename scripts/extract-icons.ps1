# Extract associated icons for files and shortcuts.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$script:appxPackageCache = @{}
$script:appxPackagesLoaded = $false

function Expand-ExistingPath([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return $null }
  $p = [Environment]::ExpandEnvironmentVariables($value.Trim().Trim('"'))
  try {
    if (Test-Path -LiteralPath $p -PathType Leaf) { return (Resolve-Path -LiteralPath $p).Path }
  } catch { }
  return $null
}

function Parse-IconLocation([string]$location) {
  if ([string]::IsNullOrWhiteSpace($location)) { return $null }
  $text = $location.Trim()
  $m = [regex]::Match($text, '^(.*?),\s*(-?\d+)\s*$')
  $rawPath = if ($m.Success) { $m.Groups[1].Value } else { $text }
  $index = if ($m.Success) { [int]$m.Groups[2].Value } else { 0 }
  $resolved = Expand-ExistingPath $rawPath
  if (-not $resolved) { return $null }
  return [PSCustomObject]@{ path = $resolved; index = $index }
}

function Add-Candidate($list, [string]$path, [int]$index = 0) {
  $resolved = Expand-ExistingPath $path
  if (-not $resolved) { return }
  $key = ($resolved.ToLowerInvariant() + '|' + $index)
  foreach ($item in $list) {
    if (($item.path.ToLowerInvariant() + '|' + $item.index) -eq $key) { return }
  }
  $list.Add([PSCustomObject]@{ path = $resolved; index = $index })
}

function Add-IconLocationCandidate($list, [string]$location) {
  $parsed = Parse-IconLocation $location
  if ($parsed) { Add-Candidate $list $parsed.path $parsed.index }
}

function Add-ShellCandidate($list, [string]$path) {
  $resolved = Expand-ExistingPath $path
  if (-not $resolved) { return }
  $list.Add([PSCustomObject]@{ path = $resolved; index = 0; shell = $true })
}

function Get-AppxIconCandidate([string]$shortcutPath) {
  try {
    $bytes = [System.IO.File]::ReadAllBytes($shortcutPath)
    $text = [System.Text.Encoding]::Unicode.GetString($bytes)
    $m = [regex]::Match($text, '(?i)([A-Za-z0-9][A-Za-z0-9.-]+_[a-z0-9]{13,})')
    if (-not $m.Success) { return $null }
    $family = $m.Groups[1].Value

    if (-not $script:appxPackagesLoaded) {
      foreach ($pkg in @(Get-AppxPackage -ErrorAction SilentlyContinue)) {
        if ($pkg.PackageFamilyName) { $script:appxPackageCache[$pkg.PackageFamilyName] = $pkg }
      }
      $script:appxPackagesLoaded = $true
    }
    $pkg = $script:appxPackageCache[$family]
    if (-not $pkg) { return $null }

    $manifestPath = Join-Path $pkg.InstallLocation 'AppxManifest.xml'
    if (-not (Test-Path -LiteralPath $manifestPath)) { return $null }
    $xml = [xml][System.IO.File]::ReadAllText($manifestPath)
    $visual = $xml.SelectSingleNode("//*[local-name()='VisualElements']")
    $logoNode = $xml.SelectSingleNode("/*[local-name()='Package']/*[local-name()='Logo']")
    $relativePaths = @()
    if ($visual) {
      $relativePaths += $visual.GetAttribute('Square44x44Logo')
      $relativePaths += $visual.GetAttribute('Square150x150Logo')
    }
    if ($logoNode) { $relativePaths += $logoNode.InnerText }
    foreach ($relative in $relativePaths) {
      if ([string]::IsNullOrWhiteSpace($relative)) { continue }
      $candidate = Expand-ExistingPath (Join-Path $pkg.InstallLocation ($relative -replace '/', '\'))
      if ($candidate) { return $candidate }
    }
  } catch { }
  return $null
}

function Add-ScriptCandidates($list, [string]$scriptPath) {
  $ext = [System.IO.Path]::GetExtension($scriptPath).ToLowerInvariant()
  if ($ext -notin @('.cmd', '.bat', '.ps1', '.vbs', '.js')) { return }
  try { $content = [System.IO.File]::ReadAllText($scriptPath) } catch { return }

  $variables = @{}
  foreach ($m in [regex]::Matches($content, '(?im)^\s*set\s+"?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^"\r\n]*)')) {
    $variables[$m.Groups[1].Value] = $m.Groups[2].Value.Trim()
  }

  $pattern = '(?i)(?:"([^"\r\n]+?\.(?:exe|dll|scr))"|([A-Za-z]:\\[^\r\n"<>|]+?\.(?:exe|dll|scr)))'
  foreach ($m in [regex]::Matches($content, $pattern)) {
    $raw = if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value }
    foreach ($v in $variables.Keys) { $raw = $raw.Replace('%' + $v + '%', $variables[$v]) }
    Add-Candidate $list $raw 0
  }
}

function Collect-Candidates($list, [string]$source, $shell, $seen, [int]$depth = 0) {
  if ($depth -gt 6) { return }
  $resolved = Expand-ExistingPath $source
  if (-not $resolved) { return }
  $key = $resolved.ToLowerInvariant()
  if ($seen.Contains($key)) { return }
  $seen.Add($key) | Out-Null

  $ext = [System.IO.Path]::GetExtension($resolved).ToLowerInvariant()
  if ($ext -eq '.lnk') {
    try {
      $sc = $shell.CreateShortcut($resolved)
      Add-IconLocationCandidate $list ([string]$sc.IconLocation)
      if ($sc.TargetPath) { Collect-Candidates $list $sc.TargetPath $shell $seen ($depth + 1) }
    } catch { }
    $appxIcon = Get-AppxIconCandidate $resolved
    if ($appxIcon) { Add-Candidate $list $appxIcon 0 }
    # Some Windows app shortcuts expose neither TargetPath nor IconLocation to WScript.Shell.
    # Let Windows Shell resolve the icon exactly as Explorer does.
    Add-ShellCandidate $list $resolved
    return
  }

  if ($ext -eq '.url') {
    try {
      $content = [System.IO.File]::ReadAllText($resolved)
      $mIcon = [regex]::Match($content, '(?im)^IconFile=(.+?)\s*$')
      if ($mIcon.Success) { Add-IconLocationCandidate $list $mIcon.Groups[1].Value.Trim() }
    } catch { }
    Add-Candidate $list $resolved 0
    return
  }

  Add-ScriptCandidates $list $resolved
  Add-Candidate $list $resolved 0
}

function Get-IconObject($candidate) {
  if (-not $candidate -or [string]::IsNullOrWhiteSpace($candidate.path)) { return $null }
  if ($candidate.shell) {
    try { return [FlowDesk.IconNative]::FromShell($candidate.path) } catch { return $null }
  }
  $ext = [System.IO.Path]::GetExtension($candidate.path).ToLowerInvariant()
  if ($ext -in @('.png', '.jpg', '.jpeg', '.bmp')) {
    try { return [System.Drawing.Bitmap]::FromFile($candidate.path) } catch { return $null }
  }
  if ($ext -eq '.ico') {
    try {
      $icon = [FlowDesk.IconNative]::Extract($candidate.path, [int]$candidate.index)
      if ($icon) { return $icon }
    } catch { }
    try { return New-Object System.Drawing.Icon($candidate.path) } catch { return $null }
  }
  if ($ext -in @('.exe', '.dll', '.scr')) {
    try {
      $icon = [FlowDesk.IconNative]::Extract($candidate.path, [int]$candidate.index)
      if ($icon) { return $icon }
    } catch { }
  }
  try { return [System.Drawing.Icon]::ExtractAssociatedIcon($candidate.path) } catch { return $null }
}

try {
  Add-Type -AssemblyName System.Drawing
  if (-not ('FlowDesk.IconNative' -as [type])) {
    Add-Type -ReferencedAssemblies 'System.Drawing' -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
namespace FlowDesk {
  public static class IconNative {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint count);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr handle);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEINFO {
      public IntPtr hIcon;
      public int iIcon;
      public uint dwAttributes;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szDisplayName;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string szTypeName;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SHGetFileInfo(string path, uint attributes, out SHFILEINFO info, uint cbFileInfo, uint flags);
    public static Icon Extract(string file, int index) {
      var large = new IntPtr[1];
      var small = new IntPtr[1];
      ExtractIconEx(file, index, large, small, 1);
      var handle = large[0] != IntPtr.Zero ? large[0] : small[0];
      if (handle == IntPtr.Zero) return null;
      try {
        using (var source = Icon.FromHandle(handle)) { return (Icon)source.Clone(); }
      } finally {
        if (large[0] != IntPtr.Zero) DestroyIcon(large[0]);
        if (small[0] != IntPtr.Zero && small[0] != large[0]) DestroyIcon(small[0]);
      }
    }

    public static Icon FromShell(string file) {
      SHFILEINFO info;
      const uint SHGFI_ICON = 0x000000100;
      var result = SHGetFileInfo(file, 0, out info, (uint)Marshal.SizeOf(typeof(SHFILEINFO)), SHGFI_ICON);
      if (result == IntPtr.Zero || info.hIcon == IntPtr.Zero) return null;
      try {
        using (var source = Icon.FromHandle(info.hIcon)) { return (Icon)source.Clone(); }
      } finally {
        DestroyIcon(info.hIcon);
      }
    }
  }
}
'@
  }

  $inputText = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($inputText)) { Write-Output '[]'; exit 0 }
  $items = $inputText | ConvertFrom-Json
  $shell = New-Object -ComObject WScript.Shell
  $results = @()

  foreach ($it in $items) {
    $entry = [PSCustomObject]@{ path = $it.path; ok = $false }
    $icon = $null
    $bitmap = $null
    $graphics = $null
    $sourceBitmap = $null
    $ownsSourceBitmap = $false
    try {
      $candidates = New-Object 'System.Collections.Generic.List[object]'
      $seen = New-Object 'System.Collections.Generic.HashSet[string]'
      Collect-Candidates $candidates $it.path $shell $seen
      foreach ($candidate in $candidates) {
        try {
          $icon = Get-IconObject $candidate
          if ($icon) { break }
        } catch {
          if ($icon) { $icon.Dispose(); $icon = $null }
        }
      }
      if (-not $icon) { $results += $entry; continue }

      $bitmap = New-Object System.Drawing.Bitmap 128, 128
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.Clear([System.Drawing.Color]::Transparent)
      if ($icon -is [System.Drawing.Bitmap]) {
        $sourceBitmap = $icon
      } else {
        $sourceBitmap = $icon.ToBitmap()
        $ownsSourceBitmap = $true
      }
      $graphics.DrawImage($sourceBitmap, 0, 0, 128, 128)

      $outDir = [System.IO.Path]::GetDirectoryName($it.output)
      if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
      $bitmap.Save($it.output, [System.Drawing.Imaging.ImageFormat]::Png)
      $entry.ok = $true
    } catch {
      $entry.ok = $false
    } finally {
      if ($graphics) { $graphics.Dispose() }
      if ($bitmap) { $bitmap.Dispose() }
      if ($ownsSourceBitmap -and $sourceBitmap) { $sourceBitmap.Dispose() }
      if ($icon) { $icon.Dispose() }
    }
    $results += $entry
  }
  Write-Output ($results | ConvertTo-Json -Compress -Depth 3)
} catch {
  Write-Output '[]'
}
