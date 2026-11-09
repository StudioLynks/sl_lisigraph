# Retire la commande « gitgraph » du PATH de l'utilisateur courant.
# Le dossier GitGraph n'est pas supprimé : effacez-le ensuite si vous le souhaitez.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'outils\path.ps1')
$bin = Join-Path $PSScriptRoot 'bin'

$entries = Get-UserPathEntries
$kept = @($entries | Where-Object { $_ -ne $bin })

Write-Host ''
if ($kept.Count -eq $entries.Count) {
  Write-Host "La commande gitgraph n'était pas installée depuis ce dossier." -ForegroundColor Yellow
} else {
  Set-UserPathEntries $kept
  Write-Host 'La commande gitgraph est désinstallée.' -ForegroundColor Green
  Write-Host 'Vous pouvez maintenant supprimer ce dossier :'
  Write-Host "  $PSScriptRoot"
}

$config = Join-Path $HOME '.gitgraph.json'
if (Test-Path $config) {
  Write-Host ''
  Write-Host "La liste des dépôts récents reste dans $config (supprimable sans risque)."
}
Write-Host ''
