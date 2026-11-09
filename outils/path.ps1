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
  [Environment]::SetEnvironmentVariable('GITGRAPH_REFRESH', '1', 'User')
  [Environment]::SetEnvironmentVariable('GITGRAPH_REFRESH', $null, 'User')
}

# Un dossier « bin » d'une installation de GitGraph (pour retrouver un ancien emplacement)
function Test-GitGraphBin([string] $dir) {
  $expanded = [Environment]::ExpandEnvironmentVariables($dir)
  return (Test-Path -LiteralPath (Join-Path $expanded 'gitgraph.cmd')) -and (Test-Path -LiteralPath (Join-Path $expanded '..\gitgraph.js'))
}
