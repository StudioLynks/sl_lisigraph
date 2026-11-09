# PATH du compte utilisateur, lu et écrit tel quel dans le registre :
# les variables comme %USERPROFILE% sont conservées au lieu d'être remplacées par leur valeur.

function Get-UserPathEntries {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
  $raw = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $key.Close()
  return @($raw -split ';' | Where-Object { $_ -ne '' })
}

function Set-UserPathEntries([string[]] $entries) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  $key.SetValue('Path', ($entries -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
  $key.Close()
  # Prévient Windows du changement, pour que les prochains terminaux voient le nouveau PATH
  [Environment]::SetEnvironmentVariable('LISIGRAPH_REFRESH', '1', 'User')
  [Environment]::SetEnvironmentVariable('LISIGRAPH_REFRESH', $null, 'User')
}

# Un dossier « bin » d'une installation de LisiGraph, ou de GitGraph (son ancien nom),
# pour retirer un ancien emplacement du PATH
function Test-LisiGraphBin([string] $dir) {
  $expanded = [Environment]::ExpandEnvironmentVariables($dir)
  foreach ($name in 'lisigraph', 'gitgraph') {
    if ((Test-Path -LiteralPath (Join-Path $expanded "$name.cmd")) -and (Test-Path -LiteralPath (Join-Path $expanded "..\$name.js"))) { return $true }
  }
  # Ancien dossier GitGraph renommé ou supprimé : l'entrée pointe vers un dossier qui n'existe plus
  return ($expanded -match '\\GitGraph\\bin\\?$') -and -not (Test-Path -LiteralPath $expanded)
}
