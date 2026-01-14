
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
|     GET | /api/entry-fees/statements/:id/subscriptions | Lignes figées du statement              |
|     GET | /api/entry-fees/statements/:id/summary       | Vue UI complète                         |
|     GET | /api/entry-fees/subscriptions/:id/statements | Historique des statements d’une souscription |
|   PATCH | /api/entry-fees/statements/:id               | Changement de statut uniquement         |
|    POST | /api/entry-fees/statements/:id/cancel        | Annulation métier (transaction + event) |

---

## 📌 Principes clés

* ✅ Statement = **document financier figé**
* ❌ Aucun recalcul des montants
* ❌ Aucune modification des lignes
* ✅ Seul champ modifiable : `status`
* ❌ Pas de DELETE → on annule via `/cancel`
* ✅ Annulation = **event négatif sur payment list**

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
* `status`
* `currency`
* `billing_group_id`

```bash
curl -s "$BASE/api/entry-fees/statements?status=TO_SEND&currency=EUR" | jq .
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
  "statement_number": "FR002",
  "status": "TO_SEND",
  "currency": "EUR",
  "total_amount": "4000"
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
      "statement_status": "TO_SEND",
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

## 📌 Lignes (subscriptions figées)

### GET `/api/entry-fees/statements/:id/subscriptions`

```bash
curl -s "$BASE/api/entry-fees/statements/{STATEMENT_ID}/subscriptions" | jq .
```

Retour :

```json
{
  "items": [
    {
      "subscription_id": "uuid",
      "snapshot_total_amount": "500"
    }
  ],
  "total": 8,
  "limit": 8
}
```

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

## 📌 Changer le statut

### PATCH `/api/entry-fees/statements/:id`

👉 **Seul champ modifiable : `status`**

```bash
curl -s -X PATCH "$BASE/api/entry-fees/statements/{STATEMENT_ID}" \
  -H "Content-Type: application/json" \
  -d '{"status":"SENT"}' | jq .
```

### Transitions autorisées

| From           | To                      |
| -------------- | ----------------------- |
| TO_SEND        | SENT                    |
| SENT           | PAYED                   |
| TO_SEND / SENT | ❌ CANCELLED (via PATCH) |
| PAYED          | ❌                       |

---

## 📌 Annuler un statement (action métier)

### POST `/api/entry-fees/statements/:id/cancel`

```bash
curl -s -X POST "$BASE/api/entry-fees/statements/{STATEMENT_ID}/cancel" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Manual cancellation"}' | jq .
```

Effets :

* `status` → `CANCELLED`
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
