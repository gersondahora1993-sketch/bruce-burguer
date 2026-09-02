$bytes = [System.IO.File]::ReadAllBytes("C:\Users\gerso\nyellen-fashion\web\src\components\ui.tsx")
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
$lines = $text -split "`n"
for ($i = 117; $i -le 124; $i++) {
  $l = $lines[$i]
  "LINE $($i+1) (len $($l.Length)): $($l)"
  $codes = ($l.ToCharArray() | ForEach-Object { '{0:X2}' -f [int]$_ }) -join ' '
  "  HEX: $codes"
}
