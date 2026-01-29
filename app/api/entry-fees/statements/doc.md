Voici une **documentation complète en Markdown**, prête à être commitée telle quelle
(ex: `docs/entry-fees-statements-api.md`).

---

```md
# Entry Fees – Statements API

API REST pour la **gestion des statements (factures figées)** liés aux entry fees.  
Cette API respecte un modèle **snapshot + historique immuable**, adapté aux objets financiers.

---

## Principes clés

- Un **statement est un document financier figé**
- Les **lignes (subscriptions)** sont des snapshots et **ne changent jamais**
- Les montants **ne sont jamais recalculés**
- La seule mutation autorisée est le **changement de payment_status**
- L’annulation est une **action métier transactionnelle** (avec impact payment list)
- Aucun DELETE : on annule via `issue_status = CANCELLED`
- Auto-PAID à la création si `total_amount=0` (toutes lignes à 0) → `payment_status=PAID` + `paid_at=now()`

---

## Modèle de données (rappel)

### `entry_fees_statement`

| Champ | Description |
|------|-------------|
| `id` | UUID du statement |
| `entry_fees_payment_list_id` | Payment list associée |
| `group_key` | Billing group |
| `statement_number` | Numéro unique du document |
| `issue_status` | `ISSUED`, `CANCELLED` |
| `payment_status` | `UNPAID`, `PAID` |
| `currency` | Devise |
| `total_amount` | Montant total figé |
| `created_at` | Date de création |
| `paid_at` | Date de paiement (null si UNPAID) |
| `cancelled_at` | Date d’annulation (null si non annulé) |

Contrainte :
```

UNIQUE(entry_fees_payment_list_id, group_key, currency)

```

---

### `entry_fees_statement_subscription`

| Champ | Description |
|------|-------------|
| `id` | UUID |
| `entry_fees_statement_id` | Statement parent |
| `subscription_id` | ID externe |
| `snapshot_source_group_id` | Groupe source snapshot |
| `snapshot_total_amount` | Montant figé |

---

## Endpoints

Base path :
```

/api/entry-fees/statements

````

---

## 1. Lister les statements

### `GET /api/entry-fees/statements`

Retourne une liste paginée par **cursor**, avec **total global**.

#### Query params (optionnels)

| Param | Type | Description |
|-----|------|-------------|
| `payment_list_id` | uuid | Filtre par payment list |
| `issue_status` | string | `ISSUED`, `CANCELLED` |
| `payment_status` | string | `UNPAID`, `PAID` |
| `currency` | string | Ex: `EUR` |
| `billing_group_id` | string | Correspond à `group_key` |
| `limit` | number | Max 200 (défaut 50) |
| `cursor` | string | Cursor opaque |

#### Réponse

```json
{
  "items": [
    {
      "id": "uuid",
      "entry_fees_payment_list_id": "uuid",
      "group_key": "string",
      "statement_number": "FR002",
      "issue_status": "ISSUED",
      "payment_status": "UNPAID",
      "currency": "EUR",
      "total_amount": "4000",
      "created_at": "2025-03-05T10:13:00.000Z",
      "paid_at": null,
      "cancelled_at": null
    }
  ],
  "total": 4,
  "nextCursor": null,
  "limit": 50
}
````

---

## 2. Détail d’un statement

### `GET /api/entry-fees/statements/{statementId}`

Retourne le document financier figé.

#### Réponse

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
  "cancelled_at": null
}
```

#### Erreurs

* `404` : statement inexistant

---

## 3. Lignes (subscriptions + infos souscription) d’un statement

### `GET /api/entry-fees/statements/{statementId}/subscriptions`

Retourne les **lignes figées** du statement + infos de souscription (live).

#### Réponse

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
  "total": 8
}
```

Notes :

* `snapshot_total_amount` = montant fige au moment du statement (valeur officielle).
* `amount_value` / `amount_currency` = montant live de la souscription (peut differer).

---

## 4. Summary (UI-friendly)

### `GET /api/entry-fees/statements/{statementId}/summary`

Agrégation pratique pour l’UI (sans recalcul métier).

#### Réponse

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

> ⚠️ `mismatch=true` est un indicateur **diagnostic uniquement**.

---

## 5. Notice (Carbone)

### `GET /api/entry-fees/statements/{statementId}/notice`

Retourne le JSON “notice” pour le template Carbone.

### `POST /api/entry-fees/statements/{statementId}/notice/render`

Génère un PDF via Carbone, stocke dans Supabase et renvoie l’URL de preview.

### `GET /api/entry-fees/statements/{statementId}/notice/download`

Téléchargement direct du PDF (génère + upload si besoin).

### `POST /api/entry-fees/statements/notices/download`

Batch : renvoie une liste d’URLs de PDFs générés.

Notes :
* `notice.status="FINAL"` pour les statements (les previews utilisent `DRAFT`)
* si `SUPABASE_BUCKET_PUBLIC=true` → URL publique sans expiration
* sinon → URL signée (expiration via `preview_expires_in` ou `SUPABASE_SIGNED_URL_EXPIRES`)
* Carbone : si `CARBONE_TEMPLATE_VERSION_ID` est défini, il est utilisé en priorité (recommandé avec clés test)
* Previews : bucket dédié via `SUPABASE_PREVIEW_BUCKET` + `SUPABASE_PREVIEW_BUCKET_PUBLIC`

---

## 6. Modifier le payment_status d’un statement

### `PATCH /api/entry-fees/statements/{statementId}`

👉 **Seul champ modifiable : `payment_status`**

#### Body

```json
{
  "payment_status": "PAID"
}
```

#### Transitions autorisées

| From     | To       |
| -------- | -------- |
| `UNPAID` | `PAID`   |
| `PAID`   | `UNPAID` |

Notes :

* `paid_at` est mis à `now()` quand le status passe à `PAID`.
* `paid_at` est remis à `null` quand on repasse à `UNPAID`.

#### Erreurs

* `400` : payment_status invalide ou transition interdite
* `404` : statement inconnu

---

## 7. Annuler un statement (action métier)

### `POST /api/entry-fees/statements/{statementId}/cancel`

Annule définitivement un statement.

### Règles

* Transaction DB obligatoire
* `issue_status` → `CANCELLED`
* `payment_status` inchangé
* `cancelled_at` → `now()`
* Création d’un **event négatif** sur la payment list
* Anti double-annulation

#### Body (optionnel)

```json
{
  "reason": "Manual cancellation"
}
```

#### Réponse

```json
{
  "statement": { ... },
  "event": {
    "id": "uuid"
  }
}
```

#### Erreurs

* `404` : statement inconnu
* `409` : déjà annulé
* `500` : échec transactionnel

---

## Ce que l’API ne fait PAS (volontairement)

❌ Modifier :

* `total_amount`
* `currency`
* `group_key`
* `statement_number`
* les lignes (`entry_fees_statement_subscription`)

❌ Recalculer un statement
❌ Supprimer un statement

---

## Bonnes pratiques côté client

* Considérer un statement comme **immutable**
* Toujours utiliser `/cancel` pour annuler
* Ne jamais dériver un statut “facturé” côté DB (calcul uniquement)
* Utiliser `total` pour la pagination UI

---

## Résumé

Cette API fournit :

* ✔️ un modèle financier robuste
* ✔️ une surface d’écriture minimale
* ✔️ une traçabilité complète
* ✔️ une compatibilité UI / export / audit

👉 **Conçue pour durer sans dette métier.**

```
