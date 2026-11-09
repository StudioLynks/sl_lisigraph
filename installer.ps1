# Installe la commande « lisigraph » pour l'utilisateur courant :
# vérifie Git et Node.js, puis ajoute le dossier bin de LisiGraph au PATH du compte.
# À relancer si le dossier LisiGraph est déplacé.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'outils\path.ps1')
$bin = Join-Path $PSScriptRoot 'bin'
$ok = $true

Write-Host ''
Write-Host 'Installation de LisiGraph' -ForegroundColor Cyan
Write-Host ''

# Git
if (Get-Command git -ErrorAction SilentlyContinue) {
  Write-Host "  [OK] Git      $((git --version) -replace '^git version ', '')"
} else {
  Write-Host '  [!!] Git est introuvable : installez-le depuis https://git-scm.com' -ForegroundColor Red
  $ok = $false
}

# Node.js 18 ou plus
if (Get-Command node -ErrorAction SilentlyContinue) {
  $version = (node --version).TrimStart('v')
  if ([int]($version.Split('.')[0]) -ge 18) {
    Write-Host "  [OK] Node.js  $version"
  } else {
    Write-Host "  [!!] Node.js $version est trop ancien : la version 18 ou plus est nécessaire (https://nodejs.org)" -ForegroundColor Red
    $ok = $false
  }
} else {
  Write-Host '  [!!] Node.js est introuvable : installez la version LTS depuis https://nodejs.org' -ForegroundColor Red
  $ok = $false
}

if (-not $ok) {
  Write-Host ''
  Write-Host 'Installation interrompue. Relancez ce script une fois les logiciels ci-dessus installés.' -ForegroundColor Yellow
  exit 1
}

# On retire un ancien emplacement de LisiGraph (dossier déplacé), puis on ajoute celui-ci
$entries = Get-UserPathEntries
$kept = @($entries | Where-Object { $_ -eq $bin -or -not (Test-LisiGraphBin $_) })
$removed = $entries.Count - $kept.Count
if ($kept -notcontains $bin) { $kept += $bin }
Set-UserPathEntries $kept

Write-Host "  [OK] Commande ajoutée : $bin"
if ($removed -gt 0) { Write-Host '       (ancien emplacement retiré)' }

Write-Host ''
Write-Host 'LisiGraph est installé.' -ForegroundColor Green
Write-Host 'Fermez et rouvrez vos terminaux (et VS Code), puis tapez :  lisigraph  (ou simplement : lisi)'
Write-Host ''
