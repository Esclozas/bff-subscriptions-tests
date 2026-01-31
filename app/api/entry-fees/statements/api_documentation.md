
# API Entry Fees — Statements (résumé compact)

API de gestion des **statements (factures)** d’entry fees.  
Les statements sont des **documents financiers figés** (snapshot).



````md
## Tester localement

```bash
cd bff-subscriptions-tests
npm run dev
````

Base URL :

```bash
BASE="http://localhost:3000"
```

---

## 📌 Routes principales

| Méthode | Route                                        | Description courte                      |
| ------: | -------------------------------------------- | --------------------------------------- |
|     GET | /api/entry-fees/statements                   | Liste des statements (metadata)         |
|     GET | /api/entry-fees/statements/:id               | Détail d’un statement                   |
|     GET | /api/entry-fees/statements/:id/subscriptions | Lignes + infos souscription (live)      |
|     GET | /api/entry-fees/statements/:id/summary       | Vue UI complète                         |
|     GET | /api/entry-fees/statements/:id/notice        | JSON notice (Carbone)                   |
|    POST | /api/entry-fees/statements/:id/notice/render | Génère PDF + upload storage             |
|     GET | /api/entry-fees/statements/:id/notice/download | Téléchargement direct PDF             |
|    POST | /api/entry-fees/statements/notices/download  | Batch download (URLs)                   |
|     GET | /api/entry-fees/subscriptions/:id/statements | Historique des statements d’une souscription |
|   PATCH | /api/entry-fees/statements/:id               | Changement de payment_status uniquement |
|    POST | /api/entry-fees/statements/payment-status/batch | Changement payment_status en batch   |
|    POST | /api/entry-fees/statements/:id/cancel        | Annulation métier (transaction + event) |

---

## 📌 Principes clés

* ✅ Statement = **document financier figé**
* ❌ Aucun recalcul des montants
* ❌ Aucune modification des lignes
* ✅ Seul champ modifiable : `payment_status`
* ❌ Pas de DELETE → on annule via `/cancel`
* ✅ Annulation = **event négatif sur payment list**
* ✅ Auto-PAID à la création si `total_amount=0` (toutes lignes à 0) → `payment_status=PAID` + `paid_at=now()`
* ✅ PDF notice : **généré une seule fois**, stocké et **jamais réécrit**

---

## 📌 Pagination (cursor-based)

### Paramètres

| Param  | Description                         |
| ------ | ----------------------------------- |
| limit  | Nombre d’items (max 200, défaut 50) |
| cursor | Curseur opaque retourné par l’API   |
| total  | Nombre total d’items filtrés        |

### Exemple

```bash
curl -s "$BASE/api/entry-fees/statements?limit=2" | jq .
```

Page suivante :

```bash
curl -s "$BASE/api/entry-fees/statements?limit=2&cursor=XXX" | jq .
```

---

## 📌 Lister les statements

### GET `/api/entry-fees/statements`

Filtres possibles :

* `payment_list_id`
* `issue_status`
* `payment_status`
* `currency`
* `billing_group_id`

```bash
curl -s "$BASE/api/entry-fees/statements?issue_status=ISSUED&currency=EUR" | jq .
```

Réponse :

```json
{
  "items": [ ... ],
  "total": 4,
  "nextCursor": null,
  "limit": 50
}
```

Notes :

* `subscriptions_count` est inclus dans chaque item (nombre de souscriptions liées au statement).
* `paid_at` est renseigné quand `payment_status=PAID`, vidé quand `UNPAID`.
* `cancelled_at` est renseigné quand `issue_status=CANCELLED`.
* `notice_pdf_generated_at` / `notice_pdf_path` / `notice_pdf_file_name` / `notice_pdf_bucket` indiquent si le PDF notice existe déjà.

---

## 📌 Détail d’un statement

### GET `/api/entry-fees/statements/:id`

```bash
curl -s "$BASE/api/entry-fees/statements/{STATEMENT_ID}" | jq .
```

Retour :

```json
{
  "id": "uuid",
  "group_structure_id": "uuid",
  "statement_number": "FR002",
  "issue_status": "ISSUED",
  "payment_status": "UNPAID",
  "currency": "EUR",
  "total_amount": "4000",
  "created_at": "2025-03-05T10:13:00.000Z",
  "paid_at": null,
  "cancelled_at": null,
  "notice_pdf_generated_at": null,
  "notice_pdf_path": null,
  "notice_pdf_file_name": null,
  "notice_pdf_bucket": null,
  "subscriptions_count": 8
}
```

---

## 📌 Historique des statements d’une souscription

### GET `/api/entry-fees/subscriptions/:id/statements`

Retourne la **liste complète** des statements liés à une souscription, avec les
infos du statement + la ligne snapshot correspondante.

```bash
curl -s "$BASE/api/entry-fees/subscriptions/{SUBSCRIPTION_ID}/statements" | jq .
```

Réponse :

```json
{
  "subscription_id": "uuid",
  "items": [
    {
      "statement_id": "uuid",
      "statement_number": "PL-XXX",
      "statement_issue_status": "ISSUED",
      "statement_payment_status": "UNPAID",
      "statement_currency": "EUR",
      "statement_payment_list_id": "uuid",
      "statement_group_key": "string",
      "statement_total_amount": "4000",
      "statement_created_at": "2025-03-05T10:13:00.000Z",
      "statement_subscription_id": "uuid",
      "snapshot_source_group_id": "uuid",
      "snapshot_total_amount": "500"
    }
  ],
  "total": 1
}
```

---

## 📌 Lignes (subscriptions + infos souscription)

### GET `/api/entry-fees/statements/:id/subscriptions`

```bash
curl -s "$BASE/api/entry-fees/statements/{STATEMENT_ID}/subscriptions" | jq .
```

Retour :

```json
{
  "items": [
    {
      "id": "uuid",
      "entry_fees_statement_id": "uuid",
      "subscription_id": "uuid",
      "snapshot_source_group_id": "uuid",
      "snapshot_total_amount": "500",
      "operation_id": "OP-123",
      "investor_name": "Doe",
      "investor_first_name": "Jane",
      "fund_name": "Fund A",
      "product_name": "Product A",
      "team_id": "uuid",
      "team_name": "Team A",
      "part_name": "Part A",
      "owner_full_name": "Owner Name",
      "validation_date": "2025-03-05T10:13:00.000Z",
      "amount_value": 1000,
      "amount_currency": "EUR",
      "entry_fees_percent": 1.5,
      "entry_fees_amount": 15,
      "entry_fees_amount_total": 15
    }
  ],
  "total": 1
}
```

Notes :

* `snapshot_total_amount` = montant fige au moment du statement (valeur officielle).
* `amount_value` / `amount_currency` = montant live de la souscription (peut differer).

---

## 📌 Summary (recommandé pour l’UI)

### GET `/api/entry-fees/statements/:id/summary`

```bash
curl -s "$BASE/api/entry-fees/statements/{STATEMENT_ID}/summary" | jq .
```

Retour :

```json
{
  "statement": { ... },
  "lines": [ ... ],
  "totals": {
    "statementTotalAmount": 4000,
    "linesTotalAmount": 4000,
    "linesCount": 8,
    "mismatch": false
  }
}
```

---

## 📌 Notice (Carbone)

### GET `/api/entry-fees/statements/:id/notice`

Retourne le JSON “notice” utilisé pour le template Carbone.

```bash
curl -s "$BASE/api/entry-fees/statements/{STATEMENT_ID}/notice" | jq .
```

### POST `/api/entry-fees/statements/:id/notice/render`

Génère un PDF via Carbone, stocke dans Supabase et renvoie l’URL de preview.
Si le PDF existe déjà (`notice_pdf_generated_at`), l’API **ne re-génère pas** : elle renvoie simplement l’URL.

```bash
curl -s -X POST "$BASE/api/entry-fees/statements/{STATEMENT_ID}/notice/render" \
  -H "Content-Type: application/json" \
  -d '{ "preview_expires_in": 3600 }' | jq .
```

Exemple de réponse :

```json
{
  "notice": { "...": "..." },
  "already_generated": true,
  "file": {
    "bucket": "bucket-name",
    "path": "notices/PL-XXX.pdf",
    "file_name": "PL-XXX.pdf",
    "preview_url": "https://...",
    "expires_at": "2025-01-01T12:00:00.000Z",
    "public": false
  }
}
```

### GET `/api/entry-fees/statements/:id/notice/download`

Télécharge le PDF (génère + upload si besoin).
Si le PDF existe déjà, il est simplement servi depuis le storage.

```bash
curl -s -OJ "$BASE/api/entry-fees/statements/{STATEMENT_ID}/notice/download"
```

### POST `/api/entry-fees/statements/notices/download`

Batch : génère plusieurs PDFs et renvoie une liste d’URLs.
Les fichiers déjà générés ne sont pas re-créés.

```bash
curl -s -X POST "$BASE/api/entry-fees/statements/notices/download" \
  -H "Content-Type: application/json" \
  -d '{ "statement_ids": ["uuid1","uuid2"], "preview_expires_in": 3600 }' | jq .
```

Notes :
* `notice.status="FINAL"` pour les statements (les previews utilisent `DRAFT`)
* si `SUPABASE_BUCKET_PUBLIC=true` → URL publique sans expiration
* sinon → URL signée (expiration via `preview_expires_in` ou `SUPABASE_SIGNED_URL_EXPIRES`)
* Carbone : si `CARBONE_TEMPLATE_VERSION_ID` est défini, il est utilisé en priorité (recommandé avec clés test)
* Previews : bucket dédié via `SUPABASE_PREVIEW_BUCKET` + `SUPABASE_PREVIEW_BUCKET_PUBLIC`
* Les champs `notice_pdf_generated_at`, `notice_pdf_path`, `notice_pdf_file_name`, `notice_pdf_bucket` sont stockés au premier rendu et **jamais écrasés**.
* Nouveau stockage : `notice_pdf_path` est **technique** et stable (ex: `notices/{statement_id}.pdf`), tandis que `notice_pdf_file_name` reste le nom lisible pour l’UI.

---

## 📌 Changer le payment_status

### PATCH `/api/entry-fees/statements/:id`

👉 **Seul champ modifiable : `payment_status`**

```bash
curl -s -X PATCH "$BASE/api/entry-fees/statements/{STATEMENT_ID}" \
  -H "Content-Type: application/json" \
  -d '{"payment_status":"PAID"}' | jq .
```

### Transitions autorisées

| From   | To     |
| ------ | ------ |
| UNPAID | PAID   |
| PAID   | UNPAID |

Notes :

* `paid_at` est mis à `now()` quand le status passe à `PAID`.
* `paid_at` est remis à `null` quand on repasse à `UNPAID`.

---

## 📌 Batch payment_status

### POST `/api/entry-fees/statements/payment-status/batch`

Body :

```json
{
  "updates": [
    { "id": "uuid", "payment_status": "PAID" },
    { "id": "uuid", "payment_status": "PAID" }
  ]
}
```

Réponse (succès) :

```json
{
  "ok": true,
  "results": [ ... ],
  "errors": []
}
```

Réponse (erreur) :

```json
{
  "ok": false,
  "code": "STATEMENT_NOT_FOUND",
  "message": "Statement not found",
  "results": [],
  "errors": [{ "op": "update", "index": 0, "statement_id": "uuid", "code": "STATEMENT_NOT_FOUND" }]
}
```

Notes :

* Opération **transactionnelle** : tout ou rien.
* Si un `id` est inconnu → 404 + rollback.
* Si transition invalide → 400 + rollback.

---

## 📌 Annuler un statement (action métier)

### POST `/api/entry-fees/statements/:id/cancel`

```bash
curl -s -X POST "$BASE/api/entry-fees/statements/{STATEMENT_ID}/cancel" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Manual cancellation"}' | jq .
```

Effets :

* `issue_status` → `CANCELLED`
* `payment_status` inchangé
* `cancelled_at` → `now()`
* création d’un **event négatif** sur la payment list
* transaction DB atomique
* anti double-annulation

### Erreurs possibles

| Code | Cas                  |
| ---- | -------------------- |
| 404  | statement inexistant |
| 409  | déjà annulé          |
| 500  | échec transaction    |

---

## 📌 Ce que l’API ne fait PAS (volontairement)

❌ Modifier :

* `total_amount`
* `currency`
* `group_key`
* `statement_number`
* les lignes (`statement_subscription`)

❌ Recalculer un statement
❌ Supprimer un statement

---

## 📌 Quand utiliser quoi (UI)

| Besoin UI            | Endpoint                               |
| -------------------- | -------------------------------------- |
| Liste avec compteurs | GET /entry-fees/statements             |
| Page détail          | GET /entry-fees/statements/:id/summary |
| Audit / vérif        | GET /subscriptions                     |
| Annulation           | POST /statements/:id/cancel            |

---

## 🧠 Modèle conceptuel (rappel)

Statement = snapshot financier immuable à un instant T.

* entry_fees_statement

  * metadata
  * currency
  * total_amount (figé)

* entry_fees_statement_subscription

  * lignes figées
  * snapshots des montants

* entry_fees_payment_list_event

  * ajustements (annulations)
  * audit / traçabilité

---

## 🚫 Anti-patterns

* PUT / PATCH sur montants
* Rebuild / recompute
* Delete
* Modifier les lignes

👉 Toute correction passe par une **annulation + nouvel objet**.

```
