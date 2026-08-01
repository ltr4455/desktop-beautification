# 批量提取文件/快捷方式关联图标为 128x128 PNG（stdin 传入 JSON 数组 [{path, output}]）
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  Add-Type -AssemblyName System.Drawing
  $inputText = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($inputText)) { Write-Output '[]'; exit 0 }
  $items = $inputText | ConvertFrom-Json
  $shell = New-Object -ComObject WScript.Shell
  $results = @()
  foreach ($it in $items) {
    $entry = [PSCustomObject]@{ path = $it.path; ok = $false }
    try {
      $src = $it.path
      $ext = [System.IO.Path]::GetExtension($src).ToLower()
      if ($ext -eq '.lnk' -or $ext -eq '.url') {
        $sc = $shell.CreateShortcut($src)
        if ($ext -eq '.url') {
          # .url 的目标是 URL 协议（不是文件路径）：优先用 IconFile 指定的图标文件
          $content = [System.IO.File]::ReadAllText($src)
          $mIcon = [regex]::Match($content, '(?im)^IconFile=(.+?)\s*$')
          if ($mIcon.Success -and (Test-Path -LiteralPath $mIcon.Groups[1].Value.Trim())) {
            $src = $mIcon.Groups[1].Value.Trim()
          } elseif ($sc.TargetPath -and (Test-Path -LiteralPath $sc.TargetPath)) {
            $src = $sc.TargetPath
          }
        } elseif ($sc.TargetPath -and (Test-Path -LiteralPath $sc.TargetPath)) {
          $src = $sc.TargetPath
        }
      }
      if (-not (Test-Path -LiteralPath $src)) { $results += $entry; continue }
      $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($src)
      if ($null -eq $icon) { $results += $entry; continue }
      $bmp = New-Object System.Drawing.Bitmap 128, 128
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.Clear([System.Drawing.Color]::Transparent)
      $g.DrawImage($icon.ToBitmap(), 0, 0, 128, 128)
      $outDir = [System.IO.Path]::GetDirectoryName($it.output)
      if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
      $bmp.Save($it.output, [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose(); $icon.Dispose()
      $entry.ok = $true
    } catch {
      $entry.ok = $false
    }
    $results += $entry
  }
  Write-Output ($results | ConvertTo-Json -Compress -Depth 3)
} catch {
  Write-Output '[]'
}
