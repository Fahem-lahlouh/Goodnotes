# iPad : installation et validation manuelle

## Installer sur l'écran d'accueil
1. Ouvrir l'adresse de Calame dans **Safari** (pas dans une autre application).
2. Bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. Lancer Calame depuis l'icône : l'application s'ouvre **sans barre Safari** (mode standalone).
4. Ouvrir une fois chaque écran avec du réseau, puis tester en mode Avion : l'app doit se lancer et écrire.

Le mode standalone (écran d'accueil) est distinct du plein écran du navigateur (API Fullscreen), qui n'est pas
utilisé. Les données de l'app installée sont séparées de celles de Safari : créez vos carnets **dans l'app
installée** (ou transférez-les par sauvegarde/restauration).

## Procédure de validation (≈ 15 min)

Activer d'abord **Réglages → Afficher les mesures de performance** et noter les valeurs affichées.
Reporter les résultats dans `docs/TESTS.md` (section « Validation iPad »).

| # | Scénario | Attendu |
| --- | --- | --- |
| 1 | Écrire une ligne de texte rapidement au Pencil | Trait continu, sans angles ni trous ; la pointe suit sans retard gênant |
| 2 | Appuyer plus fort puis plus léger | Le trait s'épaissit puis s'affine |
| 3 | Réglages → Effet de l'inclinaison 100 %, écrire stylet incliné | Trait plus large |
| 4 | Poser la paume sur l'écran puis écrire | Aucun trait parasite, pas de défilement pendant l'écriture |
| 5 | Faire glisser un doigt | La page défile, aucun trait (après la 1re utilisation du Pencil) |
| 6 | Pincer à deux doigts, écrire, dézoomer | Zoom fluide ; le trait est exactement sous la pointe ; reste net |
| 7 | Toucher à deux doigts / trois doigts | Annuler / rétablir |
| 8 | Appui long au Pencil sans bouger | Pas de loupe, pas de menu, pas de sélection de texte |
| 9 | Pivoter l'iPad pendant l'édition | Même endroit de la page affiché ; l'écriture reste alignée |
| 10 | Gomme partielle au milieu d'un mot | Seule la zone touchée disparaît ; ⌘Z/2 doigts la restaure |
| 11 | Lasso autour d'un mot, glisser, poignée bas-droite | Déplacement et redimensionnement ; persistent après relance |
| 12 | Écrire puis **forcer la fermeture** (balayer l'app) immédiatement | À la réouverture, le dernier trait est présent |
| 13 | Mode Avion → relancer → écrire → réactiver le réseau | Tout fonctionne ; aucune perte |
| 14 | Exporter une sauvegarde vers Fichiers | Le fichier `.calame` apparaît dans Fichiers |
| 15 | Clavier externe : P/H/E/L, ⌘Z, ⌘0 | Raccourcis actifs |
| 16 | Lancer Calame dans Split View / Slide Over | Mise en page lisible, écriture correcte |
| 17 | Mode concentration (icône ⛶) | Seules la barre d'outils et la page restent visibles |

Les points 1, 4 et 6 conditionnent la suite du projet : s'ils ne sont pas satisfaisants, ils seront traités
avant toute nouvelle fonctionnalité.
