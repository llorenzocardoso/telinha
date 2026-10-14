# A borderless 1280x720 window with a static, detailed test card (small text, hairlines, gradients,
# color bars, fine noise). It writes its own pixels to %TEMP%\telinha-quality-ref.png so a receiver
# can be compared against exactly what was on screen. Closes itself after -Seconds.
param([int]$Seconds = 300)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$W = 1280
$H = 720
$refPath = Join-Path $env:TEMP "telinha-quality-ref.png"
$readyPath = Join-Path $env:TEMP "telinha-quality-ref.ready"
Remove-Item $readyPath -ErrorAction SilentlyContinue

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = "None"
$form.Text = "Janela de qualidade"
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point(60, 60)
$form.ClientSize = New-Object System.Drawing.Size($W, $H)
$form.BackColor = [System.Drawing.Color]::White
$form.GetType().GetProperty("DoubleBuffered", [Reflection.BindingFlags]"NonPublic,Instance").SetValue($form, $true)

function Draw-Card($g) {
    $g.SmoothingMode = "AntiAlias"
    $g.TextRenderingHint = "ClearTypeGridFit"
    $g.Clear([System.Drawing.Color]::White)

    # horizontal gradient strip
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.Rectangle(0, 0, $W, 40)), [System.Drawing.Color]::Black, [System.Drawing.Color]::White, 0.0)
    $g.FillRectangle($grad, 0, 0, $W, 40)

    # text at several sizes, dark on light and light on dark
    $black = [System.Drawing.Brushes]::Black
    $y = 52
    foreach ($size in 8, 9, 10, 12, 14, 18, 24) {
        $font = New-Object System.Drawing.Font("Segoe UI", $size)
        $g.DrawString("Telinha $size pt - The quick brown fox jumps over the lazy dog 0123456789", $font, $black, 12, $y)
        $y += [int]($size * 1.9) + 4
    }
    $mono = New-Object System.Drawing.Font("Consolas", 10)
    $g.DrawString("function share(source) { return pipeline.start(source, { fps: 60 }); } // 1px strokes", $mono, $black, 12, $y)
    $darkBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 24, 24, 28))
    $g.FillRectangle($darkBrush, 700, 52, 568, 180)
    $light = [System.Drawing.Brushes]::WhiteSmoke
    $small = New-Object System.Drawing.Font("Segoe UI", 9)
    $mid = New-Object System.Drawing.Font("Segoe UI", 14)
    $g.DrawString("Light text on a dark panel", $mid, $light, 712, 60)
    for ($i = 0; $i -lt 8; $i++) { $g.DrawString("Line $i - small interface text, 9 pt, anti-aliased edges", $small, $light, 712, 96 + $i * 17) }

    # 1 px grid and hairline diagonals
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 60, 60, 60), 1)
    for ($x = 0; $x -le 320; $x += 8) { $g.DrawLine($pen, 12 + $x, 300, 12 + $x, 460) }
    for ($yy = 0; $yy -le 160; $yy += 8) { $g.DrawLine($pen, 12, 300 + $yy, 332, 300 + $yy) }
    $diag = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 200, 30, 30), 1)
    for ($i = 0; $i -lt 40; $i += 4) { $g.DrawLine($diag, 350 + $i, 300, 350 + $i + 160, 460) }

    # color bars
    $colors = @("White", "Yellow", "Cyan", "Lime", "Magenta", "Red", "Blue", "Black")
    for ($i = 0; $i -lt 8; $i++) {
        $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromName($colors[$i]))
        $g.FillRectangle($b, 560 + $i * 40, 300, 40, 160)
    }

    # smooth radial gradient
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse(900, 280, 260, 200)
    $rg = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
    $rg.CenterColor = [System.Drawing.Color]::FromArgb(255, 255, 220, 120)
    $rg.SurroundColors = @([System.Drawing.Color]::FromArgb(255, 20, 40, 120))
    $g.FillPath($rg, $path)

    # photo-like fine noise (deterministic)
    $rnd = New-Object System.Random 42
    for ($bx = 0; $bx -lt 160; $bx += 4) {
        for ($by = 0; $by -lt 140; $by += 4) {
            $base = 90 + [int](60 * [math]::Sin($bx / 23.0) * [math]::Cos($by / 19.0))
            $v = [math]::Max(0, [math]::Min(255, $base + $rnd.Next(-40, 40)))
            $nb = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $v, [int]($v * 0.9), [int]($v * 0.8)))
            $g.FillRectangle($nb, 12 + $bx, 500 + $by, 4, 4)
        }
    }

    # UI-like widgets
    $blue = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 103, 192))
    for ($i = 0; $i -lt 5; $i++) {
        $g.FillRectangle($blue, 200 + $i * 120, 520, 108, 32)
        $g.DrawString("Button $i", $small, [System.Drawing.Brushes]::White, 214 + $i * 120, 528)
        $g.DrawRectangle($pen, 200 + $i * 120, 570, 108, 32)
        $g.DrawString("Field $i", $small, $black, 210 + $i * 120, 578)
    }
    $g.DrawString("ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz", $mid, $black, 200, 630)
    $g.DrawString("Quality reference - static card", $mid, $black, 900, 680)
}

$form.Add_Paint({ param($s, $e) Draw-Card $e.Graphics })

$form.Add_Shown({
    Start-Sleep -Milliseconds 300
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $form.DrawToBitmap($bmp, (New-Object System.Drawing.Rectangle(0, 0, $W, $H)))
    $bmp.Save($refPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Set-Content -Path $readyPath -Value "ready"
})

$end = (Get-Date).AddSeconds($Seconds)
$stop = New-Object System.Windows.Forms.Timer
$stop.Interval = 500
$stop.Add_Tick({ if ((Get-Date) -gt $end) { $form.Close() } })
$stop.Start()
[System.Windows.Forms.Application]::Run($form)
