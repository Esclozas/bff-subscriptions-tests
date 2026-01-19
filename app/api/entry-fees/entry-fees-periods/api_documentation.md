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
| POST    | /api/entry-fees/entry-fees-periods/batch                   | Batch create/update/delete (transactionnel) |
| POST    | /api/entry-fees/entry-fees-periods/validate                | Pré-validation batch (dry-run, aucune écriture) |
| PUT     | /api/entry-fees/entry-fees-periods/:periodId               | Modifie une période (start/end, DB refuse overlap) |
| DELETE  | /api/entry-fees/entry-fees-periods/:periodId               | Supprime une période |


---

## 📌 Règles métier (ultra-concis)

* Une période couvre l’intervalle **`[start_date, end_date]`**

  * `start_date` inclus
  * `end_date` inclusif
* Validation API : `start_date <= end_date`
* Anti-overlap : garanti par **Postgres (GiST / EXCLUDE)**
* Erreurs attendues :

  * `400` : dates invalides / `start_date > end_date` / batch invalide
  * `404` : période inconnue / resolve sans match / update batch sur id inconnu
  * `409` : overlap ou doublon exact
  * `204` : période supprimée avec succès

---

## ✅ Batch & Validate (multi-changements)

### Pourquoi c’est utile

* Une seule requête pour toute la modale (create/update/delete)
* Résultat global + erreurs par item
* Pas d’état partiel : **tout ou rien** (rollback si conflit)

### POST `/api/entry-fees/entry-fees-periods/batch`

* Transactionnel : delete → update → create
* `delete` d’un id inconnu = **ignoré**
* `update` d’un id inconnu = **404 + rollback**
* `errors[].index` = position dans la liste `create` / `update` / `delete`

Body :

```json
{
  "create": [{ "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }],
  "update": [{ "id": "uuid", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }],
  "delete": [{ "id": "uuid" }]
}
```

### POST `/api/entry-fees/entry-fees-periods/validate`

* Même body que `batch`
* **Dry-run transactionnel** : aucune écriture en DB
* Sert à détecter les conflits avant “Enregistrer”

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

> Retourne les périodes qui **intersectent** `[from, to]`

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
  -d '{"start_date":"2026-03-01","end_date":"2026-03-31"}' | jq .
```

### 7) Back-to-back (doit PASSER)

```bash
curl -s -X POST "$BASE/api/entry-fees/entry-fees-periods" \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2026-04-01","end_date":"2026-04-30"}' | jq .
```

### 8) Overlap (doit FAIL — 409)

```bash
curl -s -X POST "$BASE/api/entry-fees/entry-fees-periods" \
  -H "Content-Type: application/json" \
  -d '{"start_date":"2026-04-15","end_date":"2026-05-15"}' | jq .
```

---

### 9) Batch (create/update/delete)

```bash
curl -s -X POST "$BASE/api/entry-fees/entry-fees-periods/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "create": [{ "start_date": "2026-06-01", "end_date": "2026-07-01" }],
    "update": [{ "id": "UUID_TO_UPDATE", "start_date": "2026-05-01", "end_date": "2026-06-01" }],
    "delete": [{ "id": "UUID_TO_DELETE" }]
  }' | jq .
```

### 10) Validate (dry-run)

```bash
curl -s -X POST "$BASE/api/entry-fees/entry-fees-periods/validate" \
  -H "Content-Type: application/json" \
  -d '{
    "create": [{ "start_date": "2026-06-01", "end_date": "2026-07-01" }],
    "update": [{ "id": "UUID_TO_UPDATE", "start_date": "2026-05-01", "end_date": "2026-06-01" }],
    "delete": [{ "id": "UUID_TO_DELETE" }]
  }' | jq .
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

### 🔹 Batch (résultat)

```json
{
  "ok": true,
  "results": {
    "create": [{ "id": "uuid", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }],
    "update": [{ "id": "uuid", "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" }],
    "delete": ["uuid"]
  },
  "errors": []
}
```

En cas d’erreur (ex: overlap) :

```json
{
  "ok": false,
  "code": "PERIOD_OVERLAP",
  "message": "Period overlaps an existing one",
  "results": {
    "create": [],
    "update": [],
    "delete": []
  },
  "errors": [{ "op": "create", "index": 0, "code": "PERIOD_OVERLAP", "message": "Period overlaps an existing one" }]
}
```

---

### 🔹 Validate (réponse)

```json
{
  "ok": true,
  "errors": []
}
```

---

## 📌 Résolution d’une date

Une date `D` appartient à une période `P` si :

```
P.start_date <= D <= P.end_date
```

Exemples :

* `date=2026-02-01` → période commençant le `2026-02-01`
* `date=end_date` → ✅ dans la période (fin inclusive)

---

## 📌 Notes DB (Neon / Postgres)

* CHECK : `start_date < end_date` (stockage DB en fin exclusive)
* Anti-overlap : contrainte **GiST / EXCLUDE** sur `daterange(start_date, end_date, '[)')`
* API : `end_date` **inclusif** → stocké en DB comme `end_date + 1 jour`
* Les overlaps et doublons exacts déclenchent une erreur SQLSTATE `23P01` → `409 Conflict`




## 11) Supprimer une période

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
- `400` : dates invalides / `periodId` invalide / batch invalide
- `404` : période inconnue / resolve sans match / update batch sur id inconnu
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
