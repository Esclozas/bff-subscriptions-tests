# API Entry Fees Periods — Résumé ultra-concis

## Tester localement
```bash
cd bff-subscriptions-tests
npm run dev
````

### Local

```bash
BASE="http://localhost:3000"
```

### Vercel

```bash
BASE="https://bff-subscriptions-tests.vercel.app"
```

---

## 📌 Routes

> ⚠️ Toutes les routes sont désormais **namespacées sous `/api/entry-fees`**

| Méthode | Route                                                      | Description courte |
|---------|------------------------------------------------------------|---------------------|
| GET     | /api/entry-fees/entry-fees-periods                         | Liste des périodes (filtres + pagination cursor) |
| GET     | /api/entry-fees/entry-fees-periods/:periodId               | Lire une période par id |
| GET     | /api/entry-fees/entry-fees-periods/resolve?date=YYYY-MM-DD | Résout la période contenant la date |
| POST    | /api/entry-fees/entry-fees-periods                         | Crée une période |
| PUT     | /api/entry-fees/entry-fees-periods/:periodId               | Modifie une période (start/end, DB refuse overlap) |
| DELETE  | /api/entry-fees/entry-fees-periods/:periodId               | Supprime une période |


---

## 📌 Règles métier (ultra-concis)

* Une période couvre l’intervalle **`[start_date, end_date)`**

  * `start_date` inclus
  * `end_date` exclusif
* Validation API : `start_date < end_date`
* Anti-overlap : garanti par **Postgres (GiST / EXCLUDE)**
* Erreurs attendues :

  * `400` : dates invalides / `start_date >= end_date`
  * `404` : période inconnue / resolve sans match
  * `409` : overlap ou doublon exact

---

## 📌 Pagination (cursor)

| Champ        | Description                                         |
| ------------ | --------------------------------------------------- |
| `limit`      | Nombre d’items renvoyés (max 500)                   |
| `cursor`     | Pointeur opaque (base64) pour la page suivante      |
| `nextCursor` | Cursor renvoyé par l’API                            |
| `total`      | Total global des périodes correspondant aux filtres |

* Tri **stable** : `start_date ASC`, puis `id ASC`
* Cursor interne : `(start_date, id)`

---

## ✅ Exemples CURL

### 1) Lister toutes les périodes

```bash
curl -s "$BASE/api/entry-fees/entry-fees-periods" | jq .
```

### 2) Lister avec filtre d’intervalle

> Retourne les périodes qui **intersectent** `[from, to)`

```bash
curl -s "$BASE/api/entry-fees/entry-fees-periods?from=2026-01-10&to=2026-02-10" | jq .
```

### 3) Pagination cursor

```bash
# Page 1
curl -s "$BASE/api/entry-fees/entry-fees-periods?limit=2" | jq .

# Page 2
curl -s "$BASE/api/entry-fees/entry-fees-periods?limit=2&cursor=NEXT_CURSOR" | jq .
```

### 4) Lire une période par ID

```bash
curl -s "$BASE/api/entry-fees/entry-fees-periods/PERIOD_ID" | jq .
```

### 5) Resolve (date → période)

```bash
curl -s "$BASE/api/entry-fees/entry-fees-periods/resolve?date=2026-01-20" | jq .
```

### 6) Créer une période

```bash
curl -s -X POST "$BASE/api/entry-fees/entry-fees-periods" \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2026-03-01","end_date":"2026-04-01"}' | jq .
```

### 7) Back-to-back (doit PASSER)

```bash
curl -s -X POST "$BASE/api/entry-fees/entry-fees-periods" \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2026-04-01","end_date":"2026-05-01"}' | jq .
```

### 8) Overlap (doit FAIL — 409)

```bash
curl -s -X POST "$BASE/api/entry-fees/entry-fees-periods" \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2026-04-15","end_date":"2026-05-15"}' | jq .
```

---

## 📌 JSON — Réponses API

### 🔹 Période (item)

Renvoyée par :

* `GET /api/entry-fees/entry-fees-periods/:periodId`
* `GET /api/entry-fees/entry-fees-periods/resolve`

```json
{
  "id": "uuid",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD"
}
```

---

### 🔹 Liste de périodes

Renvoyée par :

* `GET /api/entry-fees/entry-fees-periods`

```json
{
  "items": [
    {
      "id": "uuid",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD"
    }
  ],
  "limit": 200,
  "nextCursor": "string | null",
  "total": 42
}
```

---

## 📌 Résolution d’une date

Une date `D` appartient à une période `P` si :

```
P.start_date <= D < P.end_date
```

Exemples :

* `date=2026-02-01` → période commençant le `2026-02-01`
* `date=end_date` → ❌ hors période (fin exclusive)

---

## 📌 Notes DB (Neon / Postgres)

* CHECK : `start_date < end_date`
* Anti-overlap : contrainte **GiST / EXCLUDE** sur `daterange(start_date, end_date, '[)')`
* Les overlaps et doublons exacts déclenchent une erreur SQLSTATE `23P01` → `409 Conflict`




## 9) Supprimer une période

```bash
curl -si -X DELETE "$BASE/api/entry-fees/entry-fees-periods/PERIOD_ID"
````

* `204 No Content` → suppression OK
* `404 Not Found` → période inexistante
* `400 Bad Request` → `periodId` invalide


---

## 3️⃣ Compléter la section “Erreurs attendues”

### 📍 Section **📌 Règles métier / Erreurs**

Ajoute une ligne :

```md
- `204` : période supprimée avec succès
````

La liste devient :

```md
- `400` : dates invalides / `periodId` invalide
- `404` : période inconnue / resolve sans match
- `409` : overlap ou doublon exact
- `204` : période supprimée avec succès
```

---

## 4️⃣ (Optionnel mais pro) Ajouter une note métier

### 📍 Section **📌 Règles métier**

Ajoute ce paragraphe court :

```md
### Suppression d’une période

La suppression est autorisée tant que la période n’est pas référencée par
d’autres entités métier (payment lists, statements, exports).

La suppression est **physique** (hard delete).
```

## X) Modifier une période (PUT)

```bash
curl -s -X PUT "$BASE/api/entry-fees/entry-fees-periods/PERIOD_ID" \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2026-01-01","end_date":"2026-02-01"}' | jq .
```

