# Écriture : précision, stylos, historique, formes, zoom, conversion — rapport du 11/11/2026 (2ᵉ lot)

Légende : **[auto]** test automatisé (Vitest ou Playwright/Chromium), **[nav]** vérifié visuellement dans Chromium,
**[iPad]** à vérifier sur votre iPad avec l'Apple Pencil (procédure dans [IPAD.md](IPAD.md), scénarios 21 à 30).
Aucune validation sur iPad ni avec un Apple Pencil réel n'a été faite.

Vos notes : **aucun changement de format de stockage**. Les nouveaux traits ajoutent un champ facultatif (`style.smoothing`)
et deux valeurs d'outil (`fineliner`, `marker`) ; les traits existants sont lus et affichés comme avant. Aucune migration
n'est donc nécessaire. La copie de sécurité automatique reste en place.

## 1. Précision et fluidité du trait

**Causes identifiées (mesurées)**
1. **Lissage dépendant de la fréquence des événements.** Le lissage (« streamline » de perfect-freehand) tirait chaque point
   d'une fraction *fixe* vers le précédent, **par échantillon**. Le retard et les angles coupés variaient donc avec la
   fréquence des événements et la vitesse : à 60 Hz avec le réglage par défaut, l'encre traînait d'environ 12 unités derrière
   la pointe, et d'environ 37 unités avec un lissage à 0,6.
2. **Saut au lever du stylet.** Le trait affiché pendant l'écriture (fin « ouverte ») et le trait enregistré (fin « fermée »)
   étaient calculés différemment : la fin du trait bougeait au moment où l'on relevait le Pencil.
3. **« Goutte » au départ.** L'Apple Pencil envoie souvent une pression nulle au premier événement. Elle était remplacée par
   0,5, ce qui épaississait le début du trait quand on écrivait léger.
4. **Épaisseur variable au doigt et à la souris.** En l'absence de pression réelle, une pression *simulée* selon la vitesse
   faisait varier l'épaisseur.
5. **Petit crochet en fin de mot** (découvert pendant les essais en zoom) : la bibliothèque de rendu ignore les points
   situés à moins de 3 unités de la fin. Un crochet final tordait le contour : étranglement suivi d'un point rond détaché.

**Corrections**
- Filtre **One Euro** à la saisie (`src/ink/filter.ts`). C'est un filtre passe-bas dont la fréquence de coupure augmente avec
  la vitesse, et il se base sur le **temps réel** entre échantillons. Geste lent : le tremblement est lissé. Geste rapide :
  presque aucun lissage, donc pas de retard et des angles nets. Le comportement est le même à 60, 120 ou 240 Hz. Le doigt
  est un peu plus lissé que le stylet. Le réglage « Lissage » de chaque stylo pilote ce filtre.
- L'encre affichée va **jusqu'à la pointe** : le dernier échantillon brut est ajouté au tracé en cours. La prédiction de
  trajectoire, si elle est disponible, n'est jamais enregistrée.
- **Même calcul** pour le tracé en cours et le trait enregistré, avec le point final exact ajouté au lever : il n'y a plus de
  saut.
- Pression inconnue du premier événement : corrigée rétroactivement dès la première vraie valeur. Pression lissée
  légèrement, pour que l'épaisseur ne scintille pas.
- Doigt et souris : épaisseur constante (pas de pression simulée) pour les nouveaux traits.
- Contour calculé dans un repère 8 fois plus fin : les crochets de fin de mot sont rendus correctement. Les données ne
  changent pas.
- Traits **existants** : leurs paramètres de rendu figés sont respectés (rendu d'origine), hormis la correction des crochets.

**Tests** : [auto] `filter.test.ts` (point immobile, retard < 3 unités à 1500 unités/s à 60 et 240 Hz contre plus de 3 fois
plus avec l'ancien lissage, bruit réduit de plus de 40 %, angles conservés à 0,3 unité près pour une écriture réaliste à
240 Hz) ; `brushes.test.ts` (crochet de fin couvert par l'encre) ; e2e : tous les points saisis à moins de 0,5 px du trait
enregistré, angles compris, et fin exacte ; cas extrême d'angles franchis à vitesse constante (< 4 px) ; tracé en cours
identique au trait enregistré (recouvrement > 85 % des pixels). [nav] captures en zoom.
**Limite** : latence réelle, sensation et rejet de paume : [iPad].

## 2. Styles d'écriture

Six stylos aux rendus réellement différents, et un surligneur :

| Stylo | Rendu |
| --- | --- |
| Bille | épaisseur presque constante, légère réponse à la pression |
| **Feutre fin** (nouveau) | épaisseur parfaitement constante, net |
| Plume | pleins et déliés selon la direction (bec biseauté à 45°) et la pression |
| Pinceau | forte réponse à la pression, extrémités effilées |
| Crayon | grain de graphite, légèrement transparent |
| **Marqueur** (nouveau) | large, extrémités plates, légèrement translucide |

Chaque stylo mémorise sa couleur, son épaisseur et son lissage (panneau de l'outil, aperçu exact du trait).
**Tests** : [auto] e2e « six stylos » : outils enregistrés, nouveaux traits sans lissage au rendu, et images différentes deux à
deux (écart > 20 % pour chacune des 15 paires).

## 3. Annuler / rétablir intermittent

**Cause reproduite** : quand la fin d'un geste n'était jamais reçue (geste système de l'iPad, capture du pointeur refusée,
pointeur perdu), le geste restait « en cours ». Pendant une gomme, l'historique restait alors en groupement et le bouton
**Annuler restait grisé**. De plus, toute annulation était refusée tant qu'un outil était « actif », et le stylet suivant
était ignoré. Le symptôme : « Annuler marche une fois sur deux », souvent juste après une gomme.

**Corrections**
- Fin de geste reçue **hors du canvas** (au niveau de la fenêtre) : traitée normalement.
- Capture du pointeur perdue : le geste est terminé proprement, sans point parasite.
- Un nouveau contact du stylet alors qu'un geste est encore « en cours » : l'ancien geste, dont la fin a été perdue, est
  d'abord terminé et enregistré.
- **Annuler** reste actif pendant une gomme. S'il est touché alors que le geste en cours ne reçoit plus d'événement depuis
  0,7 s, ce geste est terminé puis l'annulation s'applique.
- Une paume posée pendant que le stylet reste immobile (maintien pour une forme) n'interrompt pas le tracé avant 4 s.
- L'infobulle du bouton nomme l'action : « Annuler : Gomme », « Rétablir : Trait »…

**Tests** : [auto] `history.test.ts` : 6 séquences aléatoires de 300 actions (traits, gomme groupée qui regomme ses propres
morceaux, déplacements mixtes traits + texte, suppressions, annulations, rétablissements multiples). À chaque étape,
annuler et rétablir donnent exactement l'état attendu, et la base simulée est identique à l'affichage. E2e : gomme sans fin
de geste puis Annuler ; trait resté en cours puis nouveau stylet ; fin reçue hors du canvas ; séquence mixte (traits,
gomme, sélection et déplacement, nouvelle page, retour) entièrement annulée puis rétablie, état vérifié à chaque étape.

## 4. Maintien pour obtenir une forme nette

Tracez une ligne, un cercle, une ellipse ou un rectangle, puis **gardez le stylet (ou le doigt) immobile sans le relever** :

- après le délai réglé (0,55 s par défaut, de 0,3 à 1,5 s), la forme reconnue s'affiche (« Droite — relevez pour valider ») ;
- pour une **droite**, l'extrémité suit encore le stylet tant qu'il n'est pas relevé ;
- au lever, la forme est enregistrée (action « Forme : … ») et une notification propose **« Garder le tracé libre »**. Ce choix
  est une action annulable. Annuler revient aussi en arrière, étape par étape.
- Formes reconnues : droite, cercle, ellipse (alignée), rectangle (aligné ou incliné). L'écriture, les zigzags et les arcs
  ouverts ne sont pas transformés. Les seuils sont relatifs à la taille du tracé.
- Réglages → Formes nettes : activer / désactiver, délai.

**Tests** : [auto] `shapes.test.ts` (7 cas, dont rectangle incliné et rejets) ; e2e : droite avec extrémité ajustée, retour au
tracé libre puis annulations ; cercle (rayon constant) et rectangle (points sur les quatre côtés) ; délai non atteint :
aucune transformation. **Limite** : le moment idéal du maintien est à régler à l'usage [iPad].

## 5. Fenêtre de zoom pour écrire précisément

- **Ouvrir / fermer** : bouton « Fenêtre de zoom » de la barre d'outils (ou touche Z) ; ✕ dans la fenêtre.
- La page **entière** reste visible au-dessus. Un **cadre bleu** indique la zone agrandie. Vous le déplacez par son onglet et
  le redimensionnez par sa poignée (en bas à droite), ce qui change le grossissement.
- Ce que vous écrivez dans la fenêtre s'inscrit **une seule fois**, directement dans le cadre, à la bonne taille et au bon
  endroit. Il apparaît instantanément sur la page.
- **Avance automatique** : quand un mot se termine dans la zone bleutée à droite, le cadre avance d'environ 60 % de sa
  largeur. Désactivable.
- **Retour à la ligne** (bouton « Ligne » ou Entrée) : retour à la marge gauche, une ou plusieurs lignes plus bas, aligné sur
  le réglage du papier.
- Boutons ◀ ▶ pour reculer ou avancer le cadre. Grossissement de ×1,25 à ×8 (boutons −/+, pincement dans la fenêtre,
  réglage). Hauteur de la fenêtre réglable en tirant la barre supérieure (20 à 60 %).
- Dans la fenêtre : tous les stylos, la gomme (taille exacte au grossissement de la fenêtre), la sélection, annuler et
  rétablir fonctionnent normalement. Au doigt (mode stylet uniquement), glisser déplace le cadre et pincer change le
  grossissement.
- Changer de page déplace le cadre sur la nouvelle page.

**Tests** : [auto] e2e : un seul trait créé, coordonnées sur la page exactes (< 0,5 unité), longueur = longueur écrite ÷
grossissement, épaisseur non multipliée, trait visible sur la page principale, annuler, rétablir, gomme dans la fenêtre,
fermeture ; avance automatique, retour à la ligne aligné sur l'interligne, déplacement du cadre par son onglet,
grossissement ; pincement et glissement au doigt (iPad émulé) ; parcours par événements synthétiques (aussi exécuté sous
WebKit en CI). [nav] captures.
**Limite** : ergonomie sur iPad (taille de l'onglet et de la poignée, hauteur par défaut, avance automatique en cursive) [iPad].

## 6. Conversion manuscrit → texte

Sélectionnez de l'écriture (lasso ou rectangle), puis touchez **« Convertir en texte »** dans la barre de sélection :

1. Le dialogue montre l'écriture sélectionnée et le champ « Texte — vérifiez et corrigez avant de remplacer ».
2. Le texte est proposé par le service choisi, ou tapé par vous. Corrigez-le, réglez la taille, puis **« Remplacer les
   traits »**.
3. Le remplacement est **une seule action** : Annuler restaure l'écriture d'origine.

Services disponibles, dépendances et coûts : voir [RECONNAISSANCE.md](RECONNAISSANCE.md). Par défaut, **aucun service
externe** n'est utilisé (saisie manuelle, ou Scribble sur iPad, qui est local et gratuit).

**Tests** : [auto] e2e : saisie manuelle, remplacement, annulation, et aucune requête externe ; Google Cloud Vision avec
réponse simulée (une seule requête, image seule, `languageHints: ['fr']`, texte corrigé avant remplacement) ; erreur du
service (message clair, saisie manuelle possible). **Non testé** : qualité réelle de la reconnaissance sur votre écriture
(aucune clé n'a été utilisée) [iPad].
