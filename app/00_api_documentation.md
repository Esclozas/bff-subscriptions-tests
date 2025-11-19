# API Subscriptions — Résumé ultra-concis

# Tester local
cd bff-subscriptions-tests
npm run dev

# Local
BASE="http://localhost:3000"

# Ou Vercel
BASE="https://bff-subscriptions-tests.vercel.app"




# 📌 Routes

| Méthode | Route                                | Description courte |
|---------|--------------------------------------|---------------------|
| GET     | /api/subscriptions                   | Liste aplatie (overview + Neon), pagination, filtres, tri |
| GET     | /api/subscriptions/:id               | Détail aplati pour 1 subscription |
| PUT     | /api/subscriptions/:id/extra         | Écrit/merge dans Neon (modifie les champs entry_fees_*, closing*) |
| DELETE  | /api/subscriptions/:id/extra         | Supprime toutes les données Neon liées à la subscription |

---

# 📌 Pagination — Résumé ultra-concis

| Valeur        | Sert à quoi ?                                    | Utilité concrète                            | Utilisé où ?                  |
|---------------|--------------------------------------------------|---------------------------------------------|-------------------------------|
| **limit**     | Nombre d’items renvoyés par l’API (max 250)      | Contrôle la taille d’une page UI            | UI ↔️ BFF                     |
| **offset**    | Position de départ dans la liste finale          | Permet le scroll infini (page suivante)     | UI ↔️ BFF                     |
| **PAGE_SIZE** | Taille des pages pour appeler developv4 (5000)   | Charge *toutes* les données sans timeout    | BFF → upstream (interne)      |


 1) 📄 1º page (par défaut, sans rien) → `limit = 250` par défaut  → `offset = 0` (début de la liste)
curl -s "$BASE/api/subscriptions" | jq .

 2) 📄 1º page (explicitement) → Même résultat mais en le demandant soi-même
curl -s "$BASE/api/subscriptions?limit=250&offset=0" | jq .

 3) 📄 2º page → On saute les 250 premières lignes  → offset = 250
 → Exemple : curl -s "$BASE/api/subscriptions?limit=250&offset=250" | jq .

 4) 📄 3º page → offset = 500 (2 × 250)
 → Exemple : curl -s "$BASE/api/subscriptions?limit=250&offset=500" | jq .


---


## 📌 Filtres texte ("contains")
Champs acceptés :
- operationId  
- partName  
- investorType  
- investorName  
- investorFirstName  
- productName  
- teamName  
- ownerName  
- ownerFirstName  
- closingName  
- entry_fees_assigned_manual_by  
- entry_fees_assigned_comment  

 → Exemple : curl -s "$BASE/api/subscriptions?closingName=clos" | jq .

---

## 📌 Filtres numériques
Champs numériques :
- amountValue  
- entry_fees_percent  
- entry_fees_amount  
- entry_fees_amount_total  
- entry_fees_assigned_amount_total  

Égalité :
    ?amountValue=1000

 → Exemple : curl -s "$BASE/api/subscriptions?amountValue=5000" | jq .

Intervalle :
    ?amountValue_min=0&amountValue_max=40000

 → Exemple : curl -s "$BASE/api/subscriptions?entry_fees_amount_total_min=1000&entry_fees_amount_total_max=4000" | jq .

---

## 📌 Filtres booléens
Champs acceptés :
- teamInternal  
- ownerInternal  
- entry_fees_assigned_overridden  

 → Exemple : curl -s "$BASE/api/subscriptions?entry_fees_assigned_overridden=true" | jq .

---

## 📌 Tri
    ?sort=amountValue&order=asc
(order = asc | desc)

 → Exemple : curl -s "$BASE/api/subscriptions?sort=amountValue&order=asc&limit=50" | jq .

---

## 📌 Mode rapide / mode global
- Pas de filtre global → 1 page upstream → rapide  
- Filtre global (texte / numériques / booléens) → charge toutes les pages → plus lent  

 → Exemple (global mode) : curl -s "$BASE/api/subscriptions?ownerName=john" | jq .

---

# 📌 PUT & DELETE Extra

PUT (merge Neon) :
    curl -s -X PUT "$BASE/api/subscriptions/ID/extra" \
      -H "Content-Type: application/json" \
      -d '{"entry_fees_amount_total":9999}' | jq .

DELETE :
    curl -si -X DELETE "$BASE/api/subscriptions/ID/extra"

---

# 📌 JSON aplati final (JSON)

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
  "ownerName": "string",
  "ownerFirstName": "string",
  "ownerEmail": "string",
  "ownerInternal": false,

  "closingId": "string",
  "closingName": "string",

  "entry_fees_percent": 0,
  "entry_fees_amount": 0,
  "entry_fees_amount_total": 0,
  "entry_fees_assigned_amount": 0,
  "entry_fees_assigned_amount_total": 0,
  "entry_fees_assigned_overridden": true,
  "entry_fees_assigned_manual_by": "string",
  "entry_fees_assigned_comment": "string"
}

---

# 📌 JSON aplati final (JSON expliqué)

# 📌 JSON aplati final (JSON expliqué)

| Champ                            | Type       | Origine   | Description courte                           |
|----------------------------------|------------|-----------|----------------------------------------------|
| subscriptionId                   | string     | upstream  | ID de la souscription                        |
| status                           | string     | upstream  | Statut (DONE, AWAITING…)                     |
| createdDate                      | string     | upstream  | Date création (ISO-8601)                     |
| updatedDate                      | string     | upstream  | Date mise à jour (ISO-8601)                  |

| signatureDate                    | string     | upstream  | Date de signature client                     |
| validationDate                   | string     | upstream  | Date de validation interne                   |

| operationId                      | string     | upstream  | Clé pour joindre Neon                        |

| amountValue                      | number     | upstream  | Montant                                      |
| amountCurrency                   | string     | upstream  | EUR, USD…                                    |

| partId                           | string     | upstream  | ID de la part                                |
| partName                         | string     | upstream  | Nom de la part                               |

| fundId                           | string     | upstream  | Alias du produit                             |
| fundName                         | string     | upstream  | Alias du produit                             |

| investorId                       | string     | upstream  | ID investisseur                              |
| investorType                     | string     | upstream  | PERSON / COMPANY                             |
| investorName                     | string     | upstream  | Nom                                          |
| investorFirstName                | string     | upstream  | Prénom                                       |

| productId                        | string     | upstream  | ID produit                                   |
| productName                      | string     | upstream  | Nom produit                                  |

| teamId                           | string     | upstream  | ID équipe                                    |
| teamName                         | string     | upstream  | Nom équipe                                   |
| teamInternal                     | boolean    | upstream  | Interne ?                                    |

| ownerId                          | string     | upstream  | ID du propriétaire                           |
| ownerName                        | string     | upstream  | Nom du propriétaire                          |
| ownerFirstName                   | string     | upstream  | Prénom du propriétaire                       |
| ownerEmail                       | string     | upstream  | Email du propriétaire                        |
| ownerInternal                    | boolean    | upstream  | Interne ?                                    |

| closingId                        | string     | Neon      | ID closing                                   |
| closingName                      | string     | Neon      | Nom closing                                  |

| entry_fees_percent               | number     | Neon      | % frais d’entrée                             |
| entry_fees_amount                | number     | Neon      | Montant                                      |
| entry_fees_amount_total          | number     | Neon      | Montant total                                |
| entry_fees_assigned_amount       | number     | Neon      | Montant assigné (nouveau champ)              |
| entry_fees_assigned_amount_total | number     | Neon      | Montant total assigné                        |
| entry_fees_assigned_overridden   | boolean    | Neon      | Override ?                                   |
| entry_fees_assigned_manual_by    | string     | Neon      | Dernière modification par                    |
| entry_fees_assigned_comment      | string     | Neon      | Commentaire interne                          |



# -------------------------------------------------------------------------------------------


## 📌 Vue groupée AG Grid — POST /api/subscriptions/grid
🔌 Body attendu
{
  "startRow": 0,
  "endRow": 100,
  "rowGroupCols": [
    { "field": "fundId" },
    { "field": "partId" },
    { "field": "closingId" },
    { "field": "teamId" },
    { "field": "distributorId" },
    { "field": "investorId" }
  ],
  "groupKeys": [],
  "sortModel": [
    { "colId": "createdDate", "sort": "desc" }
  ],
  "filterModel": {}
}

📤 Réponse
{
  "rows": [],
  "lastRow": 1234
}

📦 Exemples
1) 📄 Flat mode via /grid
curl -s -X POST "$BASE/api/subscriptions/grid" \
  -H "Content-Type: application/json" \
  -d '{"startRow":0,"endRow":20,"rowGroupCols":[],"groupKeys":[]}' | jq .

2) 📄 Groupement niveau 0 (fonds)
curl -s -X POST "$BASE/api/subscriptions/grid" \
  -H "Content-Type: application/json" \
  -d '{"startRow":0,"endRow":20,"rowGroupCols":[{"field":"fundId"}],"groupKeys":[]}' | jq .

3) 📄 Groupe niveau 1 (parts d’un fonds)
curl -s -X POST "$BASE/api/subscriptions/grid" \
  -H "Content-Type: application/json" \
  -d '{"startRow":0,"endRow":20,"rowGroupCols":[{"field":"fundId"},{"field":"partId"}],"groupKeys":["FUND-ID"]}' | jq .

4) 📄 Mode B : équipe → distributeur → fonds → …
curl -s -X POST "$BASE/api/subscriptions/grid" \
  -H "Content-Type: application/json" \
  -d '{"rowGroupCols":[{"field":"teamId"},{"field":"distributorId"},{"field":"fundId"}],"groupKeys":[]}' | jq .
