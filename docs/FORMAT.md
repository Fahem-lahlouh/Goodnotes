# Format des données

## Coordonnées
Unités « page » : 1 unité = 1 px CSS à 96 dpi. Page A4 portrait = 794 × 1123. Indépendantes du zoom,
de l'écran et de l'orientation.

## Base locale (IndexedDB `calame`, version 1)

| Magasin | Clé | Index | Contenu |
| --- | --- | --- | --- |
| `notebooks` | `id` | — | Carnet : titre, couverture, papier par défaut, `pageIds` (ordre), favori, dates, `trashedAt` |
| `pages` | `id` | `notebookId` | Page : dimensions, papier |
| `strokes` | `id` | `pageId` | Trait (ci-dessous) |
| `meta` | `key` | — | Métadonnées (ex. date de dernière sauvegarde) |

## Trait (`Stroke`, schéma v1)

```ts
{
  id: string;            // UUID v4
  pageId: string;
  tool: 'pen' | 'highlighter';
  color: '#rrggbb';
  width: number;         // épaisseur de base (unités page)
  style: { thinning, streamline, tilt, realPressure };  // paramètres de rendu figés
  points: Float32Array;  // 5 valeurs par point : x, y, pression 0..1, t (ms depuis le début), inclinaison 0..1
  bbox: [minX, minY, maxX, maxY];
  order: number;         // empilement
  createdAt: number;
  v: 1;
}
```

Le temps par point permet de rejouer l'écriture et, plus tard, de la synchroniser avec un enregistrement audio.

## Fichier de sauvegarde `.calame`

JSON UTF-8 :

```json
{
  "format": "calame-backup",
  "version": 1,
  "schema": 1,
  "app": "Calame",
  "exportedAt": "2026-11-11T08:00:00.000Z",
  "notebooks": [ /* Notebook */ ],
  "pages": [ /* Page */ ],
  "strokes": [ /* Stroke avec points en base64 */ ]
}
```

`points` y est encodé en **base64 des octets float32 little-endian** (sans perte par rapport à la base locale).

## Migrations
- Structure IndexedDB : `DB_VERSION` et bloc `upgrade` dans `src/storage/db.ts`.
- Enregistrements : champ `v`, migrations pas à pas dans `src/storage/migrations.ts`, appliquées à la lecture
  (base et fichiers importés). Une donnée d'un schéma plus récent est refusée avec un message explicite.
- v0 (accepté à l'import) : points en tableau, 4 valeurs par point, sans style.
