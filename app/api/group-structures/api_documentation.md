
# 🧱 Group Structures API — Documentation claire & opérationnelle

---

## 1️⃣ Le concept (à lire une seule fois)

### Ce qu’est une *Group Structure*

* Une **version immuable** de règles de regroupement
* Une seule version est **active** à un instant T
* Les règles définissent :
  **`source_group_id → billing_group_id`**
* Tout changement = **nouvelle version**
* Les anciennes versions ne sont **jamais modifiées**

### Règle implicite (fallback)

> Si un `source_group_id` n’est pas présent dans le mapping →
> il est facturé **seul** (source = billing)

---

## 2️⃣ Base URL & démarrage

```bash
# Local
BASE="http://localhost:3000"

# Prod (Vercel)
BASE="https://bff-subscriptions-tests.vercel.app"
```

```bash
npm run dev
```

---

## 3️⃣ Ce que l’API permet de faire (vue rapide)

| Action métier                 | Commande                                  |
| ----------------------------- | ----------------------------------------- |
| Voir toutes les versions      | `GET /api/group-structures`               |
| Voir la version active        | `GET /api/group-structures/active`        |
| Voir une version précise      | `GET /api/group-structures/:id`           |
| Lire les règles effectives    | `GET /api/group-structures/:id/map`       |
| Créer une nouvelle version    | `POST /api/group-structures`              |
| Activer une version existante | `POST /api/group-structures/:id/activate` |

👉 **Règle clé**
❌ Pas de `PUT / PATCH`
✅ Toute modification passe par `POST /api/group-structures`

---

## 4️⃣ Endpoints (référence propre)

### 🔹 Lister les versions

```http
GET /api/group-structures
```

* tri : `created_at DESC`
* pagination par **cursor**

Retour :

```json
{
  "items": [
    {
      "id": "uuid",
      "label": "Grouping v3",
      "createdAt": "ISO-8601",
      "isActive": false
    }
  ],
  "next_cursor": "opaque | null"
}
```

---

### 🔹 Version active (source de vérité)

```http
GET /api/group-structures/active
```

👉 **À appeler avant tout calcul métier**

---

### 🔹 Détails d’une version

```http
GET /api/group-structures/:id
```

* lecture seule
* audit / comparaison

---

### 🔹 Règles de regroupement (mapping)

```http
GET /api/group-structures/:id/map
```

Retour :

```json
{
  "group_structure_id": "uuid",
  "mappings": [
    {
      "source_group_id": "uuid",
      "billing_group_id": "uuid"
    }
  ]
}
```

---

## 5️⃣ Commandes essentielles (copier / coller)

### 📌 Lire

```bash
# Versions
curl -s "$BASE/api/group-structures" | jq .

# Version active
curl -s "$BASE/api/group-structures/active" | jq .

# Mapping actif
ACTIVE_ID=$(curl -s "$BASE/api/group-structures/active" | jq -r .id)
curl -s "$BASE/api/group-structures/$ACTIVE_ID/map" | jq .
```

---

### 📌 Créer une nouvelle version (immutable)

```bash
curl -s -X POST "$BASE/api/group-structures" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Grouping v3",
    "activate": true,
    "mappings": [
      {
        "source_group_id": "UUID_1",
        "billing_group_id": "UUID_PARENT"
      }
    ]
  }' | jq .
```

Règles :

* ✔️ mapping **complet**
* ✔️ `source_group_id` unique
* ✔️ `activate=true` désactive l’ancienne

---

### 📌 Activer une version existante (rollback)

```bash
curl -s -X POST "$BASE/api/group-structures/<ID>/activate" | jq .
```

---

## 6️⃣ Recettes métier (à suivre STRICTEMENT)

---

### 🔁 Modifier un parent (procédure officielle)

⚠️ **Interdit** : modifier une version existante
✅ **Autorisé** : créer une nouvelle version complète

---

#### Étape 1 — Récupérer la version active

```bash
ACTIVE_ID=$(curl -s "$BASE/api/group-structures/active" | jq -r .id)
```

---

#### Étape 2 — Récupérer TOUT le mapping

```bash
curl -s "$BASE/api/group-structures/$ACTIVE_ID/map" | jq .
```

---

#### Étape 3 — Modifier UNE règle et créer une nouvelle version

```bash
curl -s "$BASE/api/group-structures/$ACTIVE_ID/map" \
| jq --arg SOURCE "SOURCE_UUID" \
     --arg NEW_PARENT "NEW_PARENT_UUID" '
{
  label: "update parent",
  activate: true,
  mappings: (
    .mappings
    | map(
        if .source_group_id == $SOURCE
        then .billing_group_id = $NEW_PARENT
        else .
        end
      )
  )
}' \
| curl -s -X POST "$BASE/api/group-structures" \
  -H "Content-Type: application/json" \
  -d @- \
| jq .
```

---

#### Étape 4 — Vérifier

```bash
curl -s "$BASE/api/group-structures/active" | jq .
```

---

✅ Cette commande :

* copie la map active
* modifie **une seule règle**
* crée une **nouvelle version**
* l’active automatiquement


---

## 7️⃣ Règles d’or (à mettre en encadré)

* ✅ Toujours repartir de la version active
* ❌ Ne jamais poster un mapping partiel
* ✅ Chaque changement = nouvelle version
* ✅ Rollback toujours possible
* ✅ Historique conservé

---

## 🧠 Ce que tu gagnes avec cette structure

* lecture **par intention** (“je veux faire quoi ?”)
* commandes **immédiatement visibles**
* séparation claire :

  * concepts
  * référence API
  * recettes
* doc utilisable **par un autre dev sans toi**
