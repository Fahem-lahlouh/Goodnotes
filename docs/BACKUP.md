# Sauvegarde et restauration

## Ce qu'il faut savoir
- Vos notes sont enregistrées **automatiquement sur l'appareil**, à chaque trait (pastille verte « Enregistré »).
- Ce stockage du navigateur **n'est pas une sauvegarde** : il peut disparaître (suppression de l'app de l'écran
  d'accueil, « Effacer historique et données » de Safari, manque d'espace).
- Tant que la synchronisation privée n'existe pas, **la seule copie de secours est le fichier que vous exportez.**
- Calame vous le rappelle dans la bibliothèque si aucune sauvegarde n'a été exportée depuis 7 jours.

## Exporter (iPad)
1. Bibliothèque → **Stockage** → **Exporter une sauvegarde**.
2. Dans la feuille de partage : **Enregistrer dans Fichiers** → iCloud Drive (recommandé) ou « Sur mon iPad ».
3. Le fichier s'appelle `calame-sauvegarde-AAAA-MM-JJ-HHMM.calame`. Gardez-en plusieurs.

Un carnet seul : menu ⋯ du carnet → **Exporter ce carnet**.

## Restaurer
1. Bibliothèque → **Stockage** → **Restaurer…** → choisir le fichier `.calame`.
2. Un carnet absent est recréé tel quel. Un carnet **déjà présent n'est jamais écrasé** : il est importé en
   copie « (restauré) ». Vous comparez puis supprimez la version inutile.
3. La restauration se fait en une transaction : en cas d'erreur, rien n'est modifié.

## Vérifier une sauvegarde (recommandé une fois)
Sur un autre navigateur ou une fenêtre de navigation privée : ouvrir Calame → Stockage → Restaurer → vérifier
que les carnets et les traits apparaissent. Ce scénario est aussi couvert par le test automatisé
« export complet puis restauration dans un navigateur vierge ».

## En cas d'erreur d'enregistrement
La pastille devient rouge (« Erreur d'enregistrement »). Calame réessaie sans rien abandonner tant que
l'onglet reste ouvert. **Ne fermez pas l'app** : exportez une sauvegarde, libérez de l'espace, puis vérifiez que
la pastille repasse au vert.
