# A small titled window with moving colors, to be shared in the end-to-end check.
# It closes itself after the given number of seconds (default 300); closing it earlier is part of
# the test (the share must end by itself).
param([int]$Seconds = 300)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$form = New-Object System.Windows.Forms.Form
$form.Text = "Janela de teste do envio"
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point(80, 80)
$form.Size = New-Object System.Drawing.Size(900, 640)
$form.GetType().GetProperty("DoubleBuffered", [Reflection.BindingFlags]"NonPublic,Instance").SetValue($form, $true)
$script:t = 0

# A soft 440 Hz tone, played only while the flag file exists, so the end-to-end check can compare
# the viewer's audio level with and without sound. It plays from this process, so a window share
# (which captures only this process tree) carries it.
$toneFlag = Join-Path $env:TEMP "telinha-testwin.tone"
$rate = 48000
$count = $rate
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
$bw.Write([System.Text.Encoding]::ASCII.GetBytes("RIFF")); $bw.Write([int](36 + $count * 2))
$bw.Write([System.Text.Encoding]::ASCII.GetBytes("WAVEfmt ")); $bw.Write([int]16); $bw.Write([int16]1); $bw.Write([int16]1)
$bw.Write([int]$rate); $bw.Write([int]($rate * 2)); $bw.Write([int16]2); $bw.Write([int16]16)
$bw.Write([System.Text.Encoding]::ASCII.GetBytes("data")); $bw.Write([int]($count * 2))
$amp = 2600
if ($env:TONE_AMP) { $amp = [int]$env:TONE_AMP }
for ($i = 0; $i -lt $count; $i++) { $bw.Write([int16]([math]::Sin(2 * [math]::PI * 440 * $i / $rate) * $amp)) }
$ms.Position = 0
$player = New-Object System.Media.SoundPlayer($ms)
$script:playing = $false
$toneTimer = New-Object System.Windows.Forms.Timer
$toneTimer.Interval = 150
$toneTimer.Add_Tick({
    $want = Test-Path $toneFlag
    if ($want -and -not $script:playing) { $player.PlayLooping(); $script:playing = $true }
    elseif (-not $want -and $script:playing) { $player.Stop(); $script:playing = $false }
})
$toneTimer.Start()
$form.Add_Paint({
    param($s, $e)
    $g = $e.Graphics
    $g.Clear([System.Drawing.Color]::FromArgb(255, 20, 20, 24))
    for ($i = 0; $i -lt 40; $i++) {
        $h = (($i * 25 + $script:t * 5) % 360)
        $c = [System.Drawing.Color]::FromArgb(255, [int](127 + 127 * [math]::Sin($h / 57.3)), [int](127 + 127 * [math]::Sin($h / 57.3 + 2)), [int](127 + 127 * [math]::Sin($h / 57.3 + 4)))
        $b = New-Object System.Drawing.SolidBrush $c
        $x = [int](400 + 350 * [math]::Sin($script:t / 22 + $i))
        $y = [int](300 + 230 * [math]::Cos($script:t / 17 + $i * 1.3))
        $g.FillRectangle($b, $x, $y, 90, 90)
        $b.Dispose()
    }
    $g.DrawString("teste $($script:t)", (New-Object System.Drawing.Font("Consolas", 40)), [System.Drawing.Brushes]::White, 24, 20)
})
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 16
$timer.Add_Tick({ $script:t++; $form.Invalidate() })
$timer.Start()
$end = (Get-Date).AddSeconds($Seconds)
$stop = New-Object System.Windows.Forms.Timer
$stop.Interval = 500
$stop.Add_Tick({ if ((Get-Date) -gt $end) { $form.Close() } })
$stop.Start()
[System.Windows.Forms.Application]::Run($form)
