# API Subscriptions — Résumé ultra-concis (à jour)

## Tester local

```bash
cd bff-subscriptions-tests
pnpm dev
```

## Local

```bash
BASE="http://localhost:3002"
```

## Vercel

```bash
BASE="https://bff-subscriptions-tests.vercel.app"
```

---

## 📌 Routes

| Méthode | Route                        | Description                                                            |
| ------- | ---------------------------- | ---------------------------------------------------------------------- |
| GET     | /api/subscriptions           | Liste aplatie (overview + Neon + Statements), pagination, filtres, tri |
| GET     | /api/subscriptions/:id       | Détail aplati d’une souscription                                       |
| PUT     | /api/subscriptions/:id/extra | Merge des champs Neon (entry_fees_*)                                   |
| DELETE  | /api/subscriptions/:id/extra | Supprime les données Neon                                              |
| POST    | /api/subscriptions/grid      | Vue groupée AG Grid (server-side)                                      |

---

## 📌 Pagination

| Paramètre | Description                        |
| --------- | ---------------------------------- |
| limit     | Nombre d’items renvoyés (max 5000) |
| offset    | Décalage dans la liste finale      |

Exemples :

```bash
curl -s "$BASE/api/subscriptions?limit=50&offset=0" | jq .
curl -s "$BASE/api/subscriptions?limit=50&offset=50" | jq .
```

---

## 📌 Filtres texte (contains, case-insensitive)

Champs acceptés :

* operationId
* amountCurrency
* partName
* investorType
* investorName
* investorFirstName
* productName
* teamName
* ownerFullName
* statement_number

Exemple :

```bash
curl -s "$BASE/api/subscriptions?statement_number=PL-" | jq .
```

⚠️ Le filtre `statement_number` déclenche le **mode global**.

---

## 📌 Filtres numériques

Champs :

* amountValue
* entry_fees_percent
* entry_fees_amount
* entry_fees_amount_total

```bash
curl -s "$BASE/api/subscriptions?amountValue=5000" | jq .
curl -s "$BASE/api/subscriptions?entry_fees_amount_total_min=1000&entry_fees_amount_total_max=4000" | jq .
```

---

## 📌 Filtres booléens

Champs :

* teamInternal
* ownerInternal
* hasStatement (NOUVEAU)

```bash
# Avec statement actif
curl -s "$BASE/api/subscriptions?hasStatement=true" | jq .

# Sans statement
curl -s "$BASE/api/subscriptions?hasStatement=false" | jq .
```

---

## 📌 Tri

```text
?sort=<champ>&order=asc|desc
```

⚠️ `statement_number` **n’est pas triable** (ignoré volontairement).

---

## 📌 Mode rapide vs mode global

| Mode   | Quand                                  | Comportement                                          |
| ------ | -------------------------------------- | ----------------------------------------------------- |
| Rapide | Aucun filtre global                    | 1 page upstream, lookup Neon + Statements sur la page |
| Global | Filtre texte / Neon / statement_number | Chargement complet + filtres locaux                   |

---

## 📌 Enrichissement Statements

Chaque souscription est enrichie avec **un seul statement actif**.

### Règle métier

* priorité : `issue_status != CANCELLED`
* sinon : le plus récent (`created_at DESC`)

### Champs ajoutés (toujours présents, nullable)

| Champ                     | Type          | Description                        |
| ------------------------- | ------------- | ---------------------------------- |
| statement_id              | uuid | null   | ID du statement actif              |
| statement_number          | string | null | Numéro du statement                |
| statement_issue_status    | enum | null   | ISSUED / CANCELLED                 |
| statement_payment_status  | enum | null   | UNPAID / PAID                       |
| statement_currency        | string | null | Devise                             |
| statement_payment_list_id | uuid | null   | Payment list source                |

---

## 📌 JSON aplati (shape finale)

```json
{
  "subscriptionId": "string",
  "status": "string",
  "createdDate": "string",
  "updatedDate": "string",
  "signatureDate": "string",
  "validationDate": "string",
  "operationId": "string",

  "amountValue": 0,
  "amountCurrency": "string",

  "partId": "string",
  "partName": "string",

  "fundId": "string",
  "fundName": "string",

  "investorId": "string",
  "investorType": "string",
  "investorName": "string",
  "investorFirstName": "string",

  "productId": "string",
  "productName": "string",

  "teamId": "string",
  "teamName": "string",
  "teamInternal": true,

  "ownerId": "string",
  "ownerFullName": "string",
  "ownerEmail": "string",
  "ownerInternal": false,

  "entry_fees_percent": 0,
  "entry_fees_amount": 0,
  "entry_fees_amount_total": 0,

  "statement_id": "string | null",
  "statement_number": "string | null",
  "statement_issue_status": "ISSUED | CANCELLED | null",
  "statement_payment_status": "UNPAID | PAID | null",
  "statement_currency": "string | null",
  "statement_payment_list_id": "string | null"
}
```

---

## 📌 Vue groupée AG Grid — POST /api/subscriptions/grid

```json
{
  "startRow": 0,
  "endRow": 100,
  "rowGroupCols": [{ "field": "fundId" }],
  "groupKeys": [],
  "sortModel": [{ "colId": "createdDate", "sort": "desc" }],
  "filterModel": {}
}
```
