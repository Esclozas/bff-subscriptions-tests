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
- La seule mutation autorisée est le **changement de statut**
- L’annulation est une **action métier transactionnelle** (avec impact payment list)
- Aucun DELETE : on annule via `status = CANCELLED`

---

## Modèle de données (rappel)

### `entry_fees_statement`

| Champ | Description |
|------|-------------|
| `id` | UUID du statement |
| `entry_fees_payment_list_id` | Payment list associée |
| `group_key` | Billing group |
| `statement_number` | Numéro unique du document |
| `status` | `TO_SEND`, `SENT`, `PAYED`, `CANCELLED` |
| `currency` | Devise |
| `total_amount` | Montant total figé |
| `created_at` | Date de création |

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
| `status` | string | `TO_SEND`, `SENT`, `PAYED`, `CANCELLED` |
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
      "status": "TO_SEND",
      "currency": "EUR",
      "total_amount": "4000",
      "created_at": "2025-03-05T10:13:00.000Z"
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
  "statement_number": "FR002",
  "status": "TO_SEND",
  "currency": "EUR",
  "total_amount": "4000",
  "created_at": "2025-03-05T10:13:00.000Z"
}
```

#### Erreurs

* `404` : statement inexistant

---

## 3. Lignes (subscriptions) d’un statement

### `GET /api/entry-fees/statements/{statementId}/subscriptions`

Retourne les **lignes figées** du statement.

#### Réponse

```json
{
  "items": [
    {
      "subscription_id": "uuid",
      "snapshot_source_group_id": "uuid",
      "snapshot_total_amount": "500"
    }
  ],
  "total": 8,
  "limit": 8
}
```

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

## 5. Modifier le statut d’un statement

### `PATCH /api/entry-fees/statements/{statementId}`

👉 **Seul champ modifiable : `status`**

#### Body

```json
{
  "status": "SENT"
}
```

#### Transitions autorisées

| From        | To                    |
| ----------- | --------------------- |
| `TO_SEND`   | `SENT`, `CANCELLED`*  |
| `SENT`      | `PAYED`, `CANCELLED`* |
| `PAYED`     | ❌                     |
| `CANCELLED` | ❌                     |

* `CANCELLED` **interdit via PATCH** → utiliser `/cancel`.

#### Erreurs

* `400` : statut invalide ou transition interdite
* `404` : statement inconnu

---

## 6. Annuler un statement (action métier)

### `POST /api/entry-fees/statements/{statementId}/cancel`

Annule définitivement un statement.

### Règles

* Transaction DB obligatoire
* `status` → `CANCELLED`
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
