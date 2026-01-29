
# API Entry Fees — Payment Lists (Documentation officielle)

## Démarrer en local

```bash
cd bff-subscriptions-tests
npm run dev
````

```bash
BASE="http://localhost:3000"
```

---

## 🧾 Concept métier (important)

### Payment List

Un **Payment List** est un **snapshot immuable** d’un ensemble de souscriptions à un instant T.

Il contient :

* les souscriptions figées
* les totaux annoncés figés
* les **statements créés automatiquement**

👉 Un Payment List est **le point d’entrée unique** du flow comptable.

---

### Statement

Un **Statement** est un **regroupement comptable** des souscriptions d’un Payment List :

* par **team**
* par **devise**

👉 **Un statement n’existe jamais seul**
👉 **Il est toujours créé en même temps que le Payment List**

---

## 🧩 APIs impliquées dans le flow

### 🔗 APIs consommées (backend uniquement)

Ces APIs sont appelées **automatiquement côté backend** lors de la création d’un Payment List.

| API                                | Rôle                              |
| ---------------------------------- | --------------------------------- |
| `GET /api/subscriptions/all`       | Source des souscriptions aplaties |
| `GET /api/group-structures/active` | Fournit le `group_structure_id`   |
| `GET /api/subscriptions/:id`       | Debug / inspection                |

⚠️ **Jamais appelées directement par l’UI pour créer un Payment List.**

⚠️ **Créer un Payment List échoue en 409 si une souscription est déjà présente dans un statement dont le issue_status n’est pas CANCELLED.**

---

## 📌 Routes principales (Entry Fees)

| Méthode | Route                                             | Description                                     |
| ------- | ------------------------------------------------- | ----------------------------------------------- |
| GET     | `/api/entry-fees/payment-lists`                   | Liste des Payment Lists (metadata)              |
| GET     | `/api/entry-fees/payment-lists/summary`           | Liste avec totaux & net (**UI principale**)     |
| POST    | `/api/entry-fees/payment-lists`                   | **Création atomique Payment List + Statements** |
| GET     | `/api/entry-fees/payment-lists/:id`               | Détail d’un Payment List                        |
| GET     | `/api/entry-fees/payment-lists/:id/subscriptions` | Souscriptions figées                            |
| GET     | `/api/entry-fees/payment-lists/:id/statements`    | Statements générés                              |
| GET     | `/api/entry-fees/payment-lists/:id/events`        | Journal d’audit                                 |
| POST    | `/api/entry-fees/payment-lists/:id/events`        | Ajout d’un event (annulation)                   |
| GET     | `/api/entry-fees/payment-lists/:id/summary`       | Vue UI complète                                 |
| POST    | `/api/entry-fees/payment-lists/notices/preview`   | Preview JSON notices (DRAFT)                    |
| POST    | `/api/entry-fees/payment-lists/notices/preview/render` | Preview PDF notices (DRAFT)                |

---

## 🔁 `/payment-lists` vs `/payment-lists/summary`

| Endpoint                 | Contenu                 | Usage             |
| ------------------------ | ----------------------- | ----------------- |
| `/payment-lists`         | Metadata                | Back-office       |
| `/payment-lists/summary` | Metadata + totaux + net | **UI principale** |

👉 **Si l’UI affiche des montants → toujours `/summary`**


---

## 📌 Pagination (cursor-based)

| Paramètre | Description                  |
| --------- | ---------------------------- |
| `limit`   | max 200                      |
| `cursor`  | `created_at` du dernier item |
| `includeStatementsMin` | `true` → ajoute `statements_min` (ids + statuts) |

```bash
curl -s "$BASE/api/entry-fees/payment-lists/summary?limit=5" | jq .
```

Page suivante :

```bash
curl -s "$BASE/api/entry-fees/payment-lists/summary?limit=5&cursor=2026-01-07T19:16:22.166Z" | jq .
```

---

## ✅ Statistiques des notices (summary)

Chaque item de `GET /api/entry-fees/payment-lists/summary` inclut `statements_stats`.

Règles :
* `issued_*` = `issue_status=ISSUED`
* `cancelled_*` = `issue_status=CANCELLED`
* `issued_paid_*` = `ISSUED` + `PAID`
* `issued_unpaid_*` = `ISSUED` + `UNPAID`
* `cancelled_paid_*` = `CANCELLED` + `PAID`
* `cancelled_unpaid_*` = `CANCELLED` + `UNPAID`

Exemple :

```json
{
  "statements_stats": {
    "total_count": 12,
    "issued_count": 10,
    "cancelled_count": 2,
    "issued_paid_count": 6,
    "issued_unpaid_count": 4,
    "cancelled_paid_count": 0,
    "cancelled_unpaid_count": 2,
    "total_amounts": [{ "currency": "EUR", "amount": "1200.00" }],
    "issued_amounts": [{ "currency": "EUR", "amount": "1000.00" }],
    "cancelled_amounts": [{ "currency": "EUR", "amount": "200.00" }],
    "issued_paid_amounts": [{ "currency": "EUR", "amount": "600.00" }],
    "issued_unpaid_amounts": [{ "currency": "EUR", "amount": "400.00" }],
    "cancelled_paid_amounts": [{ "currency": "EUR", "amount": "0.00" }],
    "cancelled_unpaid_amounts": [{ "currency": "EUR", "amount": "200.00" }]
  }
}
```

---

## ✅ Statements minimaux (summary léger)

Si `includeStatementsMin=true`, chaque item contient :

```json
"statements_min": [
  { "id": "st_001", "issue_status": "ISSUED", "payment_status": "PAID" },
  { "id": "st_002", "issue_status": "ISSUED", "payment_status": "UNPAID" },
  { "id": "st_003", "issue_status": "CANCELLED", "payment_status": "UNPAID" }
]
```

Usage côté front :
* sélectionner uniquement `issue_status=ISSUED`
* ignorer `CANCELLED`
* utiliser les `id` pour les actions batch (paid / unpaid / cancel)

---

## 🚀 Créer un Payment List (ET les Statements)

### POST `/api/entry-fees/payment-lists`

⚠️ **Commande clé du système**

> La création du Payment List **crée automatiquement les Statements**
> Tout est exécuté **dans une seule transaction DB**

Si les statements **ne peuvent pas être créés** →
❌ **le Payment List n’est PAS créé**

Note :
* Une seule création de Payment List peut générer **plusieurs statements** (1 par `(group_key, currency)`).

Note :
* Si un statement est créé avec `total_amount=0` (toutes lignes à 0), il est **auto‑marqué PAID** (`payment_status=PAID`, `paid_at=now()`).

### Payload

```json
{
  "created_by": "user_test",
  "group_structure_id": "uuid",
  "period_label": "2026-01",
  "subscriptions": ["uuid1", "uuid2"],
  "totals": [
    { "currency": "EUR", "announced_total": "300.00" }
  ]
}
```

### Commande

```bash
curl -s -X POST "$BASE/api/entry-fees/payment-lists" \
  -H "Content-Type: application/json" \
  -d '{
    "created_by": "user_test",
    "group_structure_id": "c15d3aa5-ac24-42da-98f7-1a12d341818d",
    "period_label": "2026-01",
    "subscriptions": ["000c30e1-e155-49cb-869a-7b01337a3f6e"],
    "totals": [{ "currency": "EUR", "announced_total": "300.00" }]
  }' | jq .
```

Réponse :

```json
{
  "id": "payment_list_id",
  "subscriptions_count": 1,
  "statements_count": 1
}
```

---

## 📥 Pré-requis STRICTS

Pour **CHAQUE souscription** :

* `entry_fees_amount` existe
* `entry_fees_amount ≥ 0` (0 autorisé)
* `amountCurrency` obligatoire
* `teamId` obligatoire

👉 **Une seule souscription invalide → FAIL 400 → rollback total**

---

## 🧮 Règle de regroupement des Statements

```
(teamId, currency)
```

* `teamId` vient du JSON aplati
* `currency` = `amountCurrency`

❌ fund / part / closing / investor **n’interviennent pas**

---

## 👀 Preview des notices (DRAFT)

Permet de générer le JSON (ou le PDF) **avant** la création du Payment List / Statements.

### POST `/api/entry-fees/payment-lists/notices/preview`

```bash
curl -s -X POST "$BASE/api/entry-fees/payment-lists/notices/preview" \
  -H "Content-Type: application/json" \
  -d '{
    "subscription_ids": ["uuid1", "uuid2"],
    "group_structure_id": "uuid-optionnel",
    "issue_date": "2024-05-19"
  }' | jq .
```

Réponse :
* `notice.status = "DRAFT"`
* `notice.statementId = null`
* `notice.paymentListId = null`

### POST `/api/entry-fees/payment-lists/notices/preview/render`

Génère le PDF via Carbone et stocke dans Supabase (bucket preview).

```bash
curl -s -X POST "$BASE/api/entry-fees/payment-lists/notices/preview/render" \
  -H "Content-Type: application/json" \
  -d '{
    "subscription_ids": ["uuid1", "uuid2"],
    "group_structure_id": "uuid-optionnel",
    "issue_date": "2024-05-19",
    "preview_expires_in": 3600
  }' | jq .
```

Notes :
* `group_structure_id` est optionnel → si absent, la version active est utilisée.
* Stockage preview : `SUPABASE_PREVIEW_BUCKET` (sinon fallback sur `SUPABASE_BUCKET`).
* URL publique si `SUPABASE_PREVIEW_BUCKET_PUBLIC=true`, sinon URL signée.
* Les fichiers preview sont stockés sous `previews/`.

---

## 📄 Lire les Statements d’un Payment List

```bash
PL_ID="payment_list_id"

curl -s "$BASE/api/entry-fees/payment-lists/$PL_ID/statements" | jq .
```

---

## 🔢 `statements_count`

* ❌ pas stocké comme vérité
* ✅ **calculé à la lecture**
* toujours cohérent avec les statements existants

---

## 📉 Events & Annulations

### POST `/api/entry-fees/payment-lists/:id/events`

Seul cas autorisé : **delta négatif**

```bash
curl -s -X POST "$BASE/api/entry-fees/payment-lists/$PL_ID/events" \
  -H "Content-Type: application/json" \
  -d '{
    "currency": "EUR",
    "amount_delta": "-10.00",
    "reason": "STATEMENT_CANCELLED",
    "statement_id": "statement_uuid"
  }' | jq .
```

---

## 🚫 APIs volontairement ABSENTES

Ces APIs **n’existent pas et ne doivent jamais exister** :

```text
POST   /api/statements
PUT    /api/entry-fees/payment-lists/:id
DELETE /api/entry-fees/payment-lists/:id
POST   /api/entry-fees/payment-lists/:id/generate-statements
```

👉 **Tout passe par `POST /api/entry-fees/payment-lists`**

---

## 🧠 TL;DR

```text
POST /api/entry-fees/payment-lists
→ crée le lot
→ crée les statements
→ snapshot immuable
→ rollback total si erreur
```
