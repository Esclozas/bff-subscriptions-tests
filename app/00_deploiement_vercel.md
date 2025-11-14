# 🚀 Déploiement rapide + commandes Git + tests API

```bash

0)Compte:

lien: https://vercel.com/
email: gabriel.esclozas@b4finance.com
psw: SSO Google

projet: bff-subscriptions-tests

 1) Push sur Git terminal mac (pour Vercel)

cd /Users/gabrielesclozas/bff-subscriptions-tests
git add .
git commit -m "Deploy subscriptions BFF"
git push



2) ⚠️ Important — Vérifier le token upstream

Si une erreur 401 / 403 / 500 / 502 / 504 apparaît :

👉 Va sur Vercel → Settings → Environment Variables
👉 Mets à jour UPSTREAM_ACCESS_TOKEN

```


3) Tests rapides (terminal)

    📄 3.0)
    BASE="https://bff-subscriptions-tests.vercel.app"


    📄 3.1) Mode rapide — 20 premières valeurs :
    curl -s "$BASE/api/subscriptions?limit=20" | jq .


    📄 3.2) Page suivante (offset)
    curl -s "$BASE/api/subscriptions?limit=20&offset=20" | jq .


    📄 3.3) Filtre texte (mode global)
    curl -s "$BASE/api/subscriptions?closingName=Clos" | jq .


    📄 3.4) Filtre numérique (intervalle)
    curl -s "$BASE/api/subscriptions?amountValue_min=0&amountValue_max=50000" | jq .


    📄 3.5) PUT — modification d’un champ Neon
    SUB_ID="13e1ce90-1339-4fa1-9d6d-03abf6690e45"   

    curl -s -X PUT "$BASE/api/subscriptions/$SUB_ID/extra" \
    -H "Content-Type: application/json" \
    -d '{"entry_fees_amount_total":98}' | jq .