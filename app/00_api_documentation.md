# API Subscriptions — Résumé ultra-concis


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
| **PAGE_SIZE** | Taille des pages pour appeler developv4 (1000)   | Charge *toutes* les données sans timeout    | BFF → upstream (interne)      |


 1) 📄 1º page (par défaut, sans rien) → `limit = 250` par défaut  → `offset = 0` (début de la liste)
 → Exemple : curl -s "$BASE/api/subscriptions" | jq .

 2) 📄 1º page (explicitement) → Même résultat mais en le demandant soi-même
 → Exemple : curl -s "$BASE/api/subscriptions?limit=250&offset=0" | jq .

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
