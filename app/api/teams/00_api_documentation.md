# API Teams — Résumé ultra-concis

## Tester en local

```bash
cd bff-subscriptions-tests
npm run dev
```

## Base URL

```bash
# Local
BASE="http://localhost:3001"

# Ou Vercel
BASE="https://bff-subscriptions-tests.vercel.app"
```

---

# 📌 Routes

| Méthode | Route          | Description courte                           |
| ------- | -------------- | -------------------------------------------- |
| GET     | /api/teams     | Liste paginée des teams (proxy service-user) |
| GET     | /api/teams/all | Toutes les teams (chargement complet)        |

---

# 📌 Pagination — Résumé ultra-concis

| Valeur        | Sert à quoi ?                | Utilité concrète          | Utilisé où ?   |
| ------------- | ---------------------------- | ------------------------- | -------------- |
| **size**      | Nombre d’items par page      | Taille page UI            | UI ↔️ BFF      |
| **page**      | Index de page (0-based)      | Navigation pages          | UI ↔️ BFF      |
| **PAGE_SIZE** | Taille pages upstream (2000) | Charger tout sans timeout | BFF → upstream |

---

## 📄 Exemples pagination

### 1) 📄 1ʳᵉ page (par défaut)

```bash
curl -s "$BASE/api/teams" | jq .
```

### 2) 📄 1ʳᵉ page (explicite)

```bash
curl -s "$BASE/api/teams?page=0&size=10" | jq .
```

### 3) 📄 2ᵉ page

```bash
curl -s "$BASE/api/teams?page=1&size=10" | jq .
```

### 4) 📄 Vérifier cohérence

```bash
curl -s "$BASE/api/teams?page=0&size=10" \
| jq '{total, limit, offset, count:(.items|length)}'
```

---

# 📌 Mode ALL (tous les groupes / toutes les teams)

👉 Équivalent exact de `/api/subscriptions/all`

### 📄 Appel

```bash
curl -s "$BASE/api/teams/all" | jq .
```

### 📄 Résultat attendu

```json
{
  "items": [ ... ],
  "total": 93,
  "limit": 93,
  "offset": 0
}
```

### 📄 Sanity check

```bash
curl -s "$BASE/api/teams/all" \
| jq '{total, count:(.items|length)}'
```

---

# 📌 Filtres (client-side / jq)

*(pas encore implémentés côté BFF, mais souvent utiles en debug)*

### Teams internes

```bash
curl -s "$BASE/api/teams/all" \
| jq '.items[] | select(.internal == true)'
```

### Teams par pays

```bash
curl -s "$BASE/api/teams/all" \
| jq '.items[] | select(.distributionCountry == "FR")'
```

### Groupement par pays

```bash
curl -s "$BASE/api/teams/all" \
| jq '.items | group_by(.distributionCountry) | map({country:.[0].distributionCountry, count:length})'
```

---

# 📌 Authentification

## Via navigateur (normal)

* Cookie automatiquement forwardé :

```
Cookie: accessToken=...
```

## Via curl

```bash
curl -s "$BASE/api/teams/all" \
  -H "Cookie: accessToken=TON_TOKEN" | jq .
```

Fallback possible :

* `UPSTREAM_ACCESS_TOKEN` injecté comme cookie par le BFF

---

# 📌 JSON final (Team)

```json
{
  "id": "string",
  "name": "string",
  "internal": true,
  "logo": null,
  "distributionCountry": "FR",
  "teamSize": 0,
  "usersCanLoginSize": 0
}
```

---

# 📌 JSON final expliqué

| Champ               | Type          | Origine  | Description courte     |
| ------------------- | ------------- | -------- | ---------------------- |
| id                  | string        | upstream | ID de la team          |
| name                | string        | upstream | Nom de la team         |
| internal            | boolean       | upstream | Team interne ?         |
| logo                | string | null | upstream | Logo (non utilisé ici) |
| distributionCountry | string | null | upstream | Pays de distribution   |
| teamSize            | number        | upstream | Nombre d’utilisateurs  |
| usersCanLoginSize   | number        | upstream | Utilisateurs actifs    |

---

# 📌 Résumé express

* `/api/teams` → liste paginée
* `/api/teams/all` → **toutes les teams**
* Auth → cookie pass-through (comme subscriptions)
* Shape BFF → `{ items, total, limit, offset }`
* Architecture → identique subscriptions ✅

---

## 🔜 Étapes possibles

* `/api/teams/grid` (AG Grid row grouping)
* Filtres serveur (`internal`, `country`, `name`)
* Normalisation plus forte (flatten / rename champs)
* Cache soft (ETag / revalidate)

Si tu veux, je peux te faire **la doc AG Grid Teams** dans le même format ultra-sec que la fin de ta doc Subscriptions.
