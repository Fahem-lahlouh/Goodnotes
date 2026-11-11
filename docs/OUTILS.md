# Outils et menus façon Goodnotes — rapport du 11/11/2026 (3ᵉ lot)

Légende : **[auto]** test automatisé, **[nav]** vérifié visuellement dans Chromium (captures téléphone 390 × 844 et iPad
820 × 1180), **[iPad]** à vérifier sur votre appareil (procédure [IPAD.md](IPAD.md), scénarios 31 à 40).

## Pourquoi la fenêtre de zoom paraissait absente

La fenêtre de zoom existait et était déployée, mais **sur un écran de téléphone elle était inaccessible**. La barre
d'outils débordait vers la droite sans aucun indice visuel, ce qui cachait les boutons « Fenêtre de zoom », « Image » et
« Doigt ». La barre du haut se chevauchait aussi. Mes tests tournaient seulement aux tailles bureau et iPad : le défaut
n'avait pas été détecté.

**Corrections** [auto][nav]
- Un bouton **Outils** est fixé à droite de la barre et reste toujours visible ; il ouvre le menu Outils.
- La partie centrale de la barre défile, avec un fondu qui signale qu'il y a d'autres outils.
- Sur téléphone, la barre du haut ne garde que l'essentiel (retour, titre, pages, enregistrement, **Plus**) ; le reste est
  dans le menu **Plus**.
- Les menus s'ouvrent en panneau par le bas sur téléphone et en panneau centré sur iPad.
- Un test de bout en bout à 390 × 844 vérifie que tout est visible, puis ouvre et utilise la fenêtre de zoom.

## Menu « Outils »
| Élément | Effet | Test |
| --- | --- | --- |
| Texte | Outil texte | [auto] existant |
| **Notes repositionnables** | Note carrée colorée (6 couleurs) créée au centre de la page, texte modifiable avec l'outil Texte, annulable | [auto] |
| Images | Insertion d'une image | [auto] existant |
| **Formes** | Outil : chaque tracé reconnu (droite, cercle, ellipse, rectangle) devient net au lever, sans maintien ; sinon il reste libre | [auto] |
| **Pointeur laser** | Trait lumineux rouge qui s'efface en ~1,3 s ; jamais enregistré ni annulable | [auto] |
| Fenêtre de zoom | Ouvrir / fermer | [auto] |
| **Règle** | Règle translucide graduée avec angle affiché. Un doigt la déplace, deux doigts la font pivoter (aimantation 0°/45°/90°) ; boutons ±15° ; stylet ou souris sur son corps pour la déplacer. Un tracé commencé près d'un bord devient une droite exacte le long de ce bord. Touche R | [auto] |
| **Minuteur** | Chronomètre et compte à rebours (bip et message à la fin), calculés sur l'horloge | [auto] |
| Doigt : écrit / navigue | Bascule | [auto] existant |
| **Personnalisation de la barre d'outils** | Choix des éléments affichés (12) ; position d'Annuler/Rétablir (gauche ou droite) | [auto] |

## Menu « Plus » (page, carnet, réglages)
| Élément | Effet | Test |
| --- | --- | --- |
| **Ajouter aux favoris** | Signet sur la page ; onglet « Favoris » du panneau des pages | [auto] |
| Copier la page | Copie juste après | [auto] |
| **Ajouter la page au plan** | Titre libre ; onglet « Plan » du panneau des pages, toucher = aller à la page | [auto] |
| **Changer de modèle** | Papier (15 modèles, couleur, interligne) pour cette page ou toutes ; l'écriture ne change pas | [auto] |
| **Accéder à la page** | Saisie du numéro | [auto] |
| **Supprimer certains éléments** | Par type (stylos, crayon, surligneur, texte, notes, images), avec compte ; une action annulable | [auto] |
| **Effacer la page** | Avec confirmation ; une action annulable | [auto] |
| Supprimer la page | Avec confirmation (existant) | [auto] existant |
| Ajouter une page, pages, export de sauvegarde, plein écran, concentration | Raccourcis | [auto] partiels |
| **Aligner les objets** | Une sélection déplacée s'aimante (6 px) sur le centre de la page et sur les bords et centres des autres éléments ; guides roses affichés | [auto] |
| Sens de défilement, **barre latérale à gauche ou à droite** | | [auto] |
| **Modification des documents** | Garder l'écran allumé (Wake Lock, si le navigateur le permet), tirer pour ajouter une page, numéro de page, aperçu du trait au survol, avance automatique de la fenêtre de zoom, personnalisation de la barre | [auto] sauf Wake Lock |

## Fenêtre de zoom : compléments
- **Marges** : boutons « marge gauche → / ← » (comme Goodnotes) et marge droite réglable dans le menu « … ». Les marges
  sont affichées en pointillé sur la page et dans la fenêtre. Le retour à la ligne revient à la marge gauche. Arrivée à
  la marge droite, l'avance automatique **passe à la ligne suivante**. [auto]
- **Toucher la page au doigt** (mode stylet uniquement) place le cadre à cet endroit. [auto, iPad émulé]
- Menu « … » : grossissement, avance automatique, marge droite, marges par défaut. Hauteur par défaut portée à 40 %.

## Tirer pour ajouter une page
En navigation horizontale, balayer au-delà de la dernière page affiche « Relâcher pour ajouter une page ». Relâcher
ajoute la page et l'affiche. Option désactivable. [auto, iPad émulé]

## Données
- `Notebook.bookmarks?` (identifiants de pages) et `Notebook.outline?` (`{ pageId, title }`) : champs facultatifs. Ils
  sont exportés dans les sauvegardes, rattachés aux nouvelles pages lors d'une restauration en copie, et nettoyés à la
  suppression d'une page. [auto]
- `TextItem.note?` : couleur d'une note repositionnable (absent pour un bloc de texte simple).
- Aucune migration nécessaire : les anciens carnets s'ouvrent tels quels.

## Non proposé (et pourquoi)
- **Partager le lien pour collaborer**, commentaires : il faudrait un serveur ; Calame n'en a volontairement aucun.
  Pour transmettre un carnet : exporter une sauvegarde.
- **Enregistrer et résumer** : l'enregistrement audio est faisable plus tard ; le résumé demanderait un service d'IA
  externe (non activé sans votre accord).
- **Éléments** (autocollants), **pivoter la page**, **verrouillage par code** : pas dans ce lot. Le verrouillage est
  prévu, avec chiffrement local.
- **Onglets de documents** : un carnet à la fois dans l'app (plusieurs onglets du navigateur restent possibles).
