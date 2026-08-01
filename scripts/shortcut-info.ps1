# 批量解析 .lnk/.url 快捷方式目标（stdin 传入 JSON 数组，stdout 输出 JSON）
# 用法: echo '[{"path":"C:\\x.lnk"}]' | powershell -File shortcut-info.ps1
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  $inputText = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($inputText)) { Write-Output '[]'; exit 0 }
  $items = $inputText | ConvertFrom-Json
  $shell = New-Object -ComObject WScript.Shell
  $results = @()
  foreach ($it in $items) {
    $p = $it.path
    $entry = [PSCustomObject]@{ path = $p; target = $null; args = $null; icon = $null; ok = $false }
    try {
      if ([System.IO.Path]::GetExtension($p).ToLower() -eq '.url') {
        # .url 是纯文本：直接解析 URL= 与 IconFile=（WScript 的 TargetPath 拿不到）
        $content = [System.IO.File]::ReadAllText($p)
        $mUrl = [regex]::Match($content, '(?im)^URL=(.+?)\s*$')
        $mIcon = [regex]::Match($content, '(?im)^IconFile=(.+?)\s*$')
        $entry.target = if ($mUrl.Success) { $mUrl.Groups[1].Value.Trim() } else { $null }
        $entry.args = $null
        $entry.icon = if ($mIcon.Success) { $mIcon.Groups[1].Value.Trim() } else { $null }
        $entry.ok = $true
      } else {
        $sc = $shell.CreateShortcut($p)
        $entry.target = $sc.TargetPath
        $entry.args = $sc.Arguments
        $entry.icon = $sc.IconLocation
        $entry.ok = $true
      }
    } catch {
      $entry.ok = $false
    }
    $results += $entry
  }
  Write-Output ($results | ConvertTo-Json -Compress -Depth 3)
} catch {
  Write-Output '[]'
}
