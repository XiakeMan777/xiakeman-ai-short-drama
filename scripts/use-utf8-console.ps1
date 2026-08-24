param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Command
)

$ErrorActionPreference = "Stop"

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

try {
  chcp 65001 > $null
} catch {
  # chcp is best effort; the .NET encoding settings above are the important part.
}

if ($Command.Count -eq 0) {
  Write-Host "UTF-8 console settings applied for this PowerShell process."
  Write-Host "To keep settings in the current shell, run: . .\\scripts\\use-utf8-console.ps1"
  exit 0
}

& $Command[0] @($Command | Select-Object -Skip 1)
exit $LASTEXITCODE
