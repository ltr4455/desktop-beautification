
Add-Type -AssemblyName System.Drawing
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
$rect = New-Object System.Drawing.Rectangle 8, 8, 240, 240
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$radius = 56
$d = $radius * 2
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()
$c1 = [System.Drawing.Color]::FromArgb(255, 91, 124, 250)
$c2 = [System.Drawing.Color]::FromArgb(255, 138, 92, 246)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 45
$g.FillPath($brush, $path)
$white = [System.Drawing.Brushes]::White
$cardRects = @(
  [System.Drawing.Rectangle]::new(48, 56, 66, 88),
  [System.Drawing.Rectangle]::new(132, 44, 76, 104),
  [System.Drawing.Rectangle]::new(62, 150, 76, 62)
)
foreach ($r in $cardRects) {
  $rr = 18
  $d2 = $rr * 2
  $p2 = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p2.AddArc($r.X, $r.Y, $d2, $d2, 180, 90)
  $p2.AddArc($r.Right - $d2, $r.Y, $d2, $d2, 270, 90)
  $p2.AddArc($r.Right - $d2, $r.Bottom - $d2, $d2, $d2, 0, 90)
  $p2.AddArc($r.X, $r.Bottom - $d2, $d2, $d2, 90, 90)
  $p2.CloseFigure()
  $g.FillPath($white, $p2)
}
$g.Dispose()
$pngPath = Join-Path (Get-Location) 'assets\icon.png'
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$icoPath = Join-Path (Get-Location) 'assets\icon.ico'
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]1)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
$bw.Dispose(); $ms.Dispose()
Write-Output ("icon.png: " + (Get-Item $pngPath).Length + " bytes; icon.ico: " + (Get-Item $icoPath).Length + " bytes")
