# Format des données

## Coordonnées
Unités « page » : 1 unité = 1 px CSS à 96 dpi. Page A4 portrait = 794 × 1123. Indépendantes du zoom,
de l'écran et de l'orientation.

## Base locale (IndexedDB `calame`, version 2)

| Magasin | Clé | Index | Contenu |
| --- | --- | --- | --- |
| `notebooks` | `id` | — | Carnet : titre, couverture + motif, papier par défaut, format, orientation, type, dossier, `pageIds` (ordre), favori, dates, `trashedAt` |
| `pages` | `id` | `notebookId` | Page : dimensions, papier (modèle, couleur, espacement) |
| `strokes` | `id` | `pageId` | Trait (ci-dessous) |
| `items` | `id` | `pageId` | Objets de page : blocs de texte et images (v2) |
| `folders` | `id` | — | Dossiers (un niveau) (v2) |
| `blobs` | `id` | — | Octets des images (v2) |
| `meta` | `key` | — | Métadonnées (ex. date de dernière sauvegarde) |

Base séparée `calame-safety` : copies de sécurité automatiques (JSON `.calame`) faites avant chaque mise à niveau de la base.

## Trait (`Stroke`, schéma 2 — identique au schéma 1 sauf les nouveaux outils)

```ts
{
  id: string;            // UUID v4
  pageId: string;
  tool: 'pen' | 'fineliner' | 'fountain' | 'brush' | 'pencil' | 'marker' | 'highlighter';   // 'pen' = stylo à bille
  color: '#rrggbb';
  width: number;         // épaisseur de base (unités page)
  style: { thinning, streamline, tilt, realPressure, nibAngle?, smoothing? };  // paramètres de rendu figés
  // smoothing (depuis le 2ᵉ lot du 11/11/2026) : lissage appliqué à la SAISIE ; présent ⇒ points déjà filtrés, streamline = 0.
  // Absent (traits plus anciens) ⇒ rendu d'origine (streamline, pression simulée sans stylet).
  points: Float32Array;  // 5 valeurs par point : x, y, pression 0..1, t (ms depuis le début), inclinaison 0..1
  bbox: [minX, minY, maxX, maxY];
  order: number;         // empilement
  createdAt: number;
  v: 1 | 2;             // 2 pour les traits créés depuis le 11/11/2026
}
```

Carnet (`Notebook`) : champs facultatifs ajoutés le 11/11/2026 (3ᵉ lot), sans migration :
`bookmarks?: string[]` (pages en favori) et `outline?: { pageId: string; title: string }[]` (plan du carnet).
Bloc de texte (`TextItem`) : `note?: string` — couleur d'une note repositionnable.
Style d'un trait : `res?: number` (4ᵉ lot) — résolution de saisie en unités page, utilisée par le lissage du rendu ; 0 = pas de lissage (formes nettes) ; absent = valeur par défaut. Les points enregistrés ne sont jamais modifiés par ce lissage.

Le temps par point permet de rejouer l'écriture et, plus tard, de la synchroniser avec un enregistrement audio.

## Objets de page (schéma 2)

```ts
// Bloc de texte
{ kind: 'text', id, pageId, x, y, w, h, text, font: 'sans'|'serif'|'mono'|'rounded'|'hand', size,
  color, bold, italic, underline, align: 'left'|'center'|'right', order, createdAt, v: 2 }
// Image (octets dans le magasin `blobs`)
{ kind: 'image', id, pageId, x, y, w, h, blobId, mime, order, createdAt, v: 2 }
```

## Fichier de sauvegarde `.calame`

JSON UTF-8 :

```json
{
  "format": "calame-backup",
  "version": 2,
  "schema": 2,
  "app": "Calame",
  "exportedAt": "2026-11-11T08:00:00.000Z",
  "notebooks": [ /* Notebook */ ],
  "pages": [ /* Page */ ],
  "strokes": [ /* Stroke avec points en base64 */ ],
  "items": [ /* TextItem | ImageItem */ ],
  "folders": [ /* Folder */ ],
  "blobs": [ { "id": "...", "mime": "image/jpeg", "data": "base64…" } ]
}
```

`points` y est encodé en **base64 des octets float32 little-endian** (sans perte par rapport à la base locale).

## Migrations
- Structure IndexedDB : `DB_VERSION` et bloc `upgrade` dans `src/storage/db.ts`.
- Enregistrements : champ `v`, migrations pas à pas dans `src/storage/migrations.ts`, appliquées à la lecture
  (base et fichiers importés). Une donnée d'un schéma plus récent est refusée avec un message explicite.
- v0 (accepté à l'import) : points en tableau, 4 valeurs par point, sans style.
- v1 → v2 : ajout des champs de carnet `folderId`, `format`, `orientation`, `kind`, `coverPattern` (valeurs par défaut) ;
  traits et pages inchangés. Les fichiers `.calame` version 1 sont relus (sans objets ni dossiers).
