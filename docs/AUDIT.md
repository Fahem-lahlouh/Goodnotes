# Audit fonctionnel de Goodnotes — inventaire pour Calame

_Mis à jour le 11/11/2026._

## Méthode et limites

- **Observé** : visible sur les 4 captures de Goodnotes (version web, `web.goodnotes.com`) fournies le 11/11/2026 :
  écran « Documents » avec menu « Nouveau », dialogue « Nouveau bloc-notes » (format et couleur du papier), dialogue « Nouveau tableau blanc ».
- **Documenté** : affirmé par une page officielle de Goodnotes. Ces pages n'ont pas pu être ouvertes directement (réseau du
  conteneur de développement restreint). Les informations viennent d'extraits obtenus par moteur de recherche : [tarifs](https://www.goodnotes.com/pricing),
  [page Whiteboard](https://goodnotes.com/tools/whiteboard), [billet « building whiteboard infinite canvas »](https://www.goodnotes.com/blog/building-whiteboard-infinite-canvas),
  [nouveautés de septembre 2025](https://www.goodnotes.com/blog/features-fixes-updates-september-2025), [fiche App Store](https://apps.apple.com/us/app/goodnotes-ai-notes-docs-pdf/id1444383602?l=en-US).
- **Proposition** : idée propre à Calame, sans équivalent constaté.
- **Pas d'accès** à votre session Goodnotes (aucun navigateur connecté à votre compte n'est disponible ici). Aucun document Goodnotes n'a été ouvert
  ni modifié, aucun code ni ressource propriétaire n'a été récupéré. Tout ce qui n'apparaît ni dans les captures ni dans les sources ci-dessus est
  marqué « non vérifié ». Le contenu des modèles Goodnotes n'a pas été reproduit : les modèles de Calame sont dessinés par notre propre code.
- Les captures montrent Goodnotes, pas Calame : elles ne prouvent rien sur l'état de Calame. La colonne « État dans Calame » est vérifiée par les tests
  indiqués.

**État** : ✅ fait et testé · 🔶 partiel · ⬜ à faire · ✖ écarté (raison indiquée).

## Création et organisation

| Fonction | Source ou écran observé | Type | État dans Calame | Défaut ou manque | Priorité | Test de validation |
| --- | --- | --- | --- | --- | --- | --- |
| Bouton « Nouveau » avec menu | Capture « Documents » (menu déroulant) | Observé | ✅ Menu Nouveau : Carnet, Note rapide, Tableau blanc, Dossier, Importer une image, Restaurer | — | P0 | e2e `note rapide et tableau blanc`, `dossiers…` |
| Bloc-notes : titre, couverture, papier | Dialogue « Nouveau bloc-notes » | Observé | ✅ Titre, couverture (12 couleurs × 6 motifs), modèle de papier avec aperçu | — | P0 | e2e `création avec format, orientation et modèle` |
| Formats A3, A4, A5, A6, A7, Lettre, Tabloïd | Liste des formats (capture) | Observé | ✅ Mêmes formats, dimensions ISO / US à 96 dpi | Format « Goodnotes Standard » propriétaire non repris ; pas de format personnalisé | P1 | e2e (A5 paysage → 794 × 559) ; unitaire `formats de page, orientation…` |
| Orientation portrait / paysage | Boutons d'orientation (capture) | Observé | ✅ | — | P0 | idem |
| Papier blanc / jaune / sombre | Filtre « Papier blanc / jaune / sombre » | Observé | ✅ Blanc, Jaune, Crème, Sombre | — | P0 | aperçus du dialogue (visuel) |
| Ligné, quadrillé, pointillé, uni | Catégorie « Basique » (partiellement visible) | Observé (partiel) | ✅ | — | P0 | rendu `drawPaper` |
| Cornell | « Papier à lettres » + accueil « Cornell » | Observé | ✅ Modèle original Cornell (sujet, mots-clés, notes, synthèse) | — | P1 | aperçu + création |
| Une / deux / trois colonnes | « Une colonne », « Deux colonnes », « Trois colonnes » | Observé | 🔶 Deux et trois colonnes | Variantes « mélange » / « gauche » non reprises | P2 | aperçu |
| « Legal » | « Papier à lettres » | Observé | ⬜ | Papier ligné à marge large type « legal pad » | P3 | — |
| Plannings mensuels, listes de tâches, semainiers | Catégorie « Planning » | Observé | ✅ Planning mensuel, Liste de tâches, Semainier (dessins originaux) | Pas de variantes A/B/C ; pas de dates pré-remplies | P1 | aperçus |
| Comptabilité, musique | Catégories « Planning », « Musique » | Observé | ⬜ | Portées musicales, tableau de comptes | P3 | — |
| Modèles d'accueil (planning, tâches, carte conceptuelle, Venn, brainstorming) | Écran « Fini l'angoisse de la page blanche » | Observé | 🔶 Brainstorming (bulles), Réunion | Pas de page d'accueil de modèles ; pas de Venn ni de carte conceptuelle | P2 | — |
| Tableau blanc | Menu « Tableau blanc (NEW) », dialogue dédié | Observé | 🔶 « Tableau blanc » = grande page pointillée 2400 × 1600 | **Pas infini** (la page Goodnotes est annoncée infinie, avec mini-carte : documenté) | P2 | e2e `note rapide et tableau blanc` |
| Modèles de tableau blanc (Crazy 8, rétrospective, point quotidien…) | Dialogue « Nouveau tableau blanc » | Observé | ⬜ | — | P3 | — |
| Note rapide | Menu « Note rapide » | Observé (comportement non vérifié) | ✅ Crée et ouvre immédiatement un carnet daté, papier jaune ligné | Comportement exact de Goodnotes inconnu | P1 | e2e `note rapide…` |
| Document texte | Menu « Text Document (BETA) », carte « Document texte sans titre » | Observé | ⬜ (blocs de texte dans les pages seulement) | Document de traitement de texte à part entière | P2 | — |
| Dossiers | Menu « Dossier » | Observé | ✅ Un niveau : créer, renommer, supprimer (les carnets reviennent à la racine), déplacer | Pas de sous-dossiers (Goodnotes : imbrication citée par un avis App Store, non vérifiée) | P1 | e2e `dossiers…` |
| Favoris | Barre latérale « Favoris », étoile sur la carte | Observé | ✅ Étoile sur chaque carte + vue Favoris | — | P0 | e2e `corbeille, favoris…` |
| Tri | Bouton « Date » | Observé (options non visibles) | ✅ Modification, ouverture, création, nom | — | P1 | e2e (tri par nom) |
| Corbeille | Barre latérale « Corbeille » | Observé | ✅ Restaurer / supprimer définitivement | Pas de vidage automatique | P0 | e2e |
| Recherche | Icône loupe | Observé | 🔶 Titres seulement | Texte des blocs non indexé ; pas de recherche manuscrite | P1 | e2e (recherche « algo ») |
| Mode sélection multiple (icône ✓) | Icône en haut à droite | Observé | ⬜ | Actions groupées sur plusieurs carnets | P2 | — |
| Partagé | Barre latérale « Partagé » | Observé | ✖ | Nécessite un serveur (choix : aucune base, 100 % gratuit) | — | — |
| Boutique | « Boutique — 50+ contenus » | Observé | ✖ | Hors objectif personnel | — | — |
| Langue du modèle | Sélecteur « Français » | Observé | ✖ | Calame est en français uniquement | — | — |
| Installation web (PWA) | Bouton « Installer » de Chrome sur web.goodnotes.com | Observé | ✅ Manifeste + service worker | — | P0 | e2e hors ligne |

## Import et intégrations

| Fonction | Source | Type | État | Défaut ou manque | Priorité | Test |
| --- | --- | --- | --- | --- | --- | --- |
| Importer une image | Menu « Image » | Observé | ✅ Nouveau carnet à partir d'une image ; insertion d'image dans une page (barre d'outils) | Pas de recadrage | P1 | manuel (sélecteur de fichier) ; images incluses dans la sauvegarde (unitaire) |
| Importer un document (PDF) | Menu « Importer », accueil « Importer un document » ; imports PDF jusqu'à 1 Go (documenté, sept. 2025) | Observé + documenté | ⬜ | PDF.js (Apache-2.0) à intégrer, rendu progressif | P1 | à écrire : import, annotation, export, réouverture |
| Google Drive, OneDrive, Dropbox, Box | Menu (« Débloquer », BETA) | Observé | ✖ pour l'instant | Chaque service exige une application OAuth enregistrée chez le fournisseur et ses propres conditions ; **aucun faux bouton n'est ajouté**. Équivalent gratuit actuel : la feuille de partage d'iPadOS / l'app Fichiers (iCloud Drive, Google Drive, OneDrive installés) pour exporter et restaurer les `.calame` | P3 | — |

## Écriture (référence : documentation et usage, non visible sur les captures)

| Fonction | Source | Type | État | Défaut ou manque | Priorité | Test |
| --- | --- | --- | --- | --- | --- | --- |
| Plusieurs types de stylos | App Store (« plume », « stylo à bille », « pinceau » : non vérifié en détail) | Documenté (partiel) | ✅ Bille, plume, pinceau, crayon (rendus distincts) | — | P0 | e2e `rendus réellement différents` ; unitaire plume |
| Favoris d'outils | — | Non vérifié | ✅ Jusqu'à 8 favoris (outil, couleur, épaisseur, lissage) | — | P1 | e2e `favoris` |
| Lasso / reconnaissance de formes | Tarifs (offre gratuite) | Documenté | ✅ Lasso, rectangle, carré ; ⬜ formes | Reconnaissance de formes absente | P2 | e2e sélection |
| Texte, images | Tarifs | Documenté | ✅ Blocs de texte (5 polices, taille, G/I/S, alignement) ; images | Pas de mise en forme par caractère | P1 | e2e texte |
| Audio synchronisé | llms.txt | Documenté | ⬜ (horodatage par point déjà enregistré) | — | P2 | — |
| Reconnaissance d'écriture / recherche manuscrite | Comparatif officiel | Documenté | ⬜ | Pas d'API locale fiable dans Safari ; service externe = opt-in explicite | P2 | — |

## Propositions propres à Calame

| Proposition | Pourquoi | État | Priorité |
| --- | --- | --- | --- |
| Indicateur permanent de l'âge de la dernière sauvegarde (un toucher = export) | Sans base distante, c'est la seule protection contre la perte | ✅ | P0 |
| Copie de sécurité automatique avant chaque mise à niveau du format | Aucune mise à jour ne peut faire perdre de notes | ✅ | P0 |
| Modèles « Révision Java » (zone de code numérotée) et « Fiches question / réponse » | Vos usages : révisions de développeur | ✅ | P1 |
| Modèle « Compte rendu de réunion » (décisions / actions qui·quoi·quand / questions) | Demandé | ✅ | P1 |
| Bascule « Doigt : écrit / navigue » toujours visible | Évite de chercher le réglage | ✅ | P0 |
| Règle de sélection explicite (« entièrement inclus » / « touchés ») avec aperçu en direct | Prévisibilité | ✅ | P0 |
| Palette de commandes (⌘K) et capture rapide globale | Moins de manipulations | ⬜ | P2 |
| Liens entre pages / carnets | Relier cours, exemples, exercices | ⬜ | P2 |
| Verrouillage local par code (Web Crypto) | Espace personnel sans serveur | ⬜ | P1 |
