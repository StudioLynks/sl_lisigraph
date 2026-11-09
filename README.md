# LisiGraph

Un graphe **clair et lisible** des branches et des merges d'un dépôt Git, dans le navigateur.

- Une colonne et une couleur par branche, la branche principale (`develop`, `main`…) détectée et placée à gauche.
- Les branches supprimées retrouvées grâce aux messages de merge, les branches inactives grisées.
- Les `git pull` qui « mergent une branche dans elle-même » rangés proprement dans leur branche.
- Zoom sur une branche, comparaison de deux branches, détail d'un commit avec ses fichiers modifiés.

LisiGraph ne fait que **lire** l'historique : il ne modifie jamais un dépôt. Tout reste sur votre poste (le petit serveur n'est accessible que depuis votre ordinateur).

---

## Prérequis

- **Git**
- **Node.js 18 ou plus** : <https://nodejs.org> (version LTS). Pour vérifier : `node --version`.

Aucune autre dépendance : pas de `npm install`.

## Installation

1. Récupérez le projet :
   ```powershell
   git clone https://github.com/StudioLynks/sl_lisigraph.git LisiGraph
   ```
   Choisissez un emplacement durable : la commande pointe vers ce dossier.
2. Double-cliquez sur **`installer.cmd`** dans le dossier LisiGraph.
   Le script vérifie Git et Node.js, puis ajoute les commandes `lisigraph` et `lisi` à votre compte Windows.
3. **Fermez et rouvrez** vos terminaux (pour VS Code : redémarrez-le entièrement).

Si le dossier LisiGraph est déplacé, relancez `installer.cmd` depuis son nouvel emplacement.

## Utilisation

Dans n'importe quel terminal (PowerShell, cmd, Git Bash, terminal de VS Code) :

```powershell
lisigraph                          # le dépôt du dossier courant, sinon le dernier ouvert
lisigraph "C:\chemin\vers\projet"  # un dépôt précis
lisi                               # raccourci, identique à lisigraph
```

Le navigateur s'ouvre sur le graphe. Le terminal reste occupé tant que LisiGraph tourne : **Ctrl+C** pour l'arrêter.
Rechargez la page pour voir les nouveaux commits.

| Option | Effet |
|---|---|
| `--main develop` | Impose la branche principale si la détection se trompe |
| `--max 5000` | Nombre de commits chargés (2000 par défaut) |
| `--port 5180` | Port du serveur local (un autre est pris s'il est occupé) |
| `--no-open` | N'ouvre pas le navigateur |
| `--version` | Affiche la version |

## Dans la page

| Action | Comment |
|---|---|
| Zoomer sur une branche | Clic sur son nom (légende, étiquette, barre « Colonnes ») · **Échap** pour revenir |
| Détail d'un commit | Clic sur sa ligne · clic sur un fichier pour voir ses modifications |
| Rechercher | Champ en haut ou touche **/** · **Entrée** / **Maj+Entrée** pour naviguer |
| Comparer deux branches | Bouton **Comparer** |
| Changer de dépôt | Clic sur le nom du dépôt en haut · **Parcourir…** ou coller un chemin |
| Exporter en image | Bouton **Exporter** (PNG ou SVG de la vue actuelle) |

Options d'affichage (mémorisées) : **Aplatir les git pull**, **Structure seule** (regroupe les commits ordinaires), **Surbrillance au survol**, thème clair ou sombre.

## Mise à jour

```powershell
cd <dossier LisiGraph>
git pull
```

Puis arrêtez LisiGraph (**Ctrl+C**) et relancez `lisigraph`. La version installée est affichée en haut de la page et par `lisigraph --version`.

**Vous aviez GitGraph (l'ancien nom) ?** Relancez `installer.cmd` : l'ancienne commande `gitgraph` est retirée automatiquement, et votre liste de dépôts récents et vos réglages d'affichage sont repris.

## Désinstallation

Double-cliquez sur **`desinstaller.cmd`**, puis supprimez le dossier LisiGraph.
La liste des dépôts récents se trouve dans `%USERPROFILE%\.lisigraph.json` (supprimable sans risque).

## Dépannage

| Problème | Solution |
|---|---|
| `lisigraph` n'est pas reconnu | Rouvrez le terminal (ou VS Code) après l'installation. Sinon relancez `installer.cmd`. |
| « Le serveur ne connaît pas cette fonction » | LisiGraph a été mis à jour pendant qu'il tournait : **Ctrl+C** puis `lisigraph`. |
| Une branche apparaît comme principale à tort | `lisigraph --main <nom-de-la-branche>` |
| Il manque des commits anciens | `lisigraph --max 5000` |
| La fenêtre « Parcourir » n'apparaît pas | Elle est peut-être derrière le navigateur : regardez la barre des tâches. |
| `installer.cmd` est bloqué par Windows | Clic droit sur le fichier → Propriétés → cocher « Débloquer », ou lancer `powershell -ExecutionPolicy Bypass -File installer.ps1`. |
