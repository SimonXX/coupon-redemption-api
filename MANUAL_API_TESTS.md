# Manual API Test Playbook

Questo file serve per supervisionare manualmente la Part B senza entrare ancora nella Part C dei test automatizzati.

Tutti i comandi assumono che tu sia nella root del progetto.

## 0. Reset Pulito E Avvio

Usalo quando vuoi ripartire da dati seed deterministici.

```bash
docker compose down -v
docker compose up -d --build
```

Questo esegue prima le migrations, poi il seed locale, poi avvia l'API.

Controlla lo stato:

```bash
docker compose ps
```

Atteso:

```text
coupon-redemption-api        Up
coupon-redemption-postgres   Up healthy
coupon-redemption-adminer    Up
```

Variabile base:

```bash
export BASE_URL=http://localhost:3000
```

## 1. Health Check

```bash
curl -i "$BASE_URL/health"
```

Atteso:

```text
HTTP/1.1 200 OK
{"status":"ok","database":"ok"}
```

## 2. Recupera User Id Seedati

```bash
export ALICE_ID=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "select id from users where email = '\''alice@example.com'\'';"')
export BOB_ID=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "select id from users where email = '\''bob@example.com'\'';"')
export ADMIN_ID=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "select id from users where email = '\''admin@example.com'\'';"')

echo "ALICE_ID=$ALICE_ID"
echo "BOB_ID=$BOB_ID"
echo "ADMIN_ID=$ADMIN_ID"
```

## 3. Listing Coupon

### 3.1 Listing default

```bash
curl -i "$BASE_URL/coupons"
```

Atteso:

- `200 OK`
- `page = 1`
- `pageSize = 10`
- `items` contiene coupon disponibili e non scaduti.

### 3.2 Listing paginato

```bash
curl -i "$BASE_URL/coupons?page=1&pageSize=2"
curl -i "$BASE_URL/coupons?page=2&pageSize=2"
```

Atteso:

- `200 OK`
- ordering stabile: campaign start date, poi coupon code, poi coupon id.

### 3.3 Future campaign inclusa

```bash
curl -s "$BASE_URL/coupons?page=1&pageSize=20"
```

Controlla che `FUTURE10` sia incluso.

Ragione: il requisito chiede di includere campagne future nella listing admin se non sono scadute e hanno status `available`.

### 3.4 Coupon scaduto escluso

```bash
curl -s "$BASE_URL/coupons?page=1&pageSize=20"
```

Controlla che `EXPIRED-COUPON` non sia incluso.

### 3.5 Campaign scaduta esclusa

```bash
curl -s "$BASE_URL/coupons?page=1&pageSize=20"
```

Controlla che `EXPIRED-CAMPAIGN` non sia incluso.

### 3.6 Not available esclusi

```bash
curl -s "$BASE_URL/coupons?page=1&pageSize=20"
```

Controlla che `PAUSED10` non sia incluso.

## 4. Validazione Query Parameters

### 4.1 Page non numerica

```bash
curl -i "$BASE_URL/coupons?page=abc&pageSize=10"
```

Atteso:

```text
400 Bad Request
VALIDATION_ERROR
```

### 4.2 Page zero

```bash
curl -i "$BASE_URL/coupons?page=0&pageSize=10"
```

Atteso:

```text
400 Bad Request
VALIDATION_ERROR
```

### 4.3 Page negativa

```bash
curl -i "$BASE_URL/coupons?page=-1&pageSize=10"
```

Atteso:

```text
400 Bad Request
VALIDATION_ERROR
```

### 4.4 PageSize zero

```bash
curl -i "$BASE_URL/coupons?page=1&pageSize=0"
```

Atteso:

```text
400 Bad Request
VALIDATION_ERROR
```

### 4.5 PageSize troppo grande

```bash
curl -i "$BASE_URL/coupons?page=1&pageSize=101"
```

Atteso:

```text
400 Bad Request
VALIDATION_ERROR
```

### 4.6 Tentativo SQL injection su query parameter

```bash
curl -i "$BASE_URL/coupons?page=1%3BDROP%20TABLE%20coupons&pageSize=10"
```

Atteso:

```text
400 Bad Request
VALIDATION_ERROR
```

Verifica che la tabella esista ancora:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from coupons;"'
```

Nota: il requisito usa query parameters. Li manteniamo, ma vengono validati e passati a PostgreSQL come bind parameters. Non vengono concatenati nel SQL.

## 5. Create Campaign + Coupon

Usa un suffisso per evitare collisioni tra prove.

```bash
export SUFFIX=$(date +%s)
```

### 5.1 Crea nuova campaign e nuovo coupon

```bash
cat <<JSON | curl -i -X POST "$BASE_URL/coupons" \
  -H "content-type: application/json" \
  -d @-
{
  "campaign": {
    "name": "Manual Campaign $SUFFIX",
    "description": "Manual campaign created from curl",
    "status": "available",
    "startTimestamp": "2026-05-01T00:00:00.000Z",
    "endTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 10
  },
  "coupon": {
    "code": "MANUAL-$SUFFIX",
    "status": "available",
    "expirationTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 3
  }
}
JSON
```

Atteso:

```text
201 Created
```

Controlla da API:

```bash
curl -s "$BASE_URL/coupons?page=1&pageSize=100"
```

### 5.2 Campaign esistente: crea solo nuovo coupon

```bash
export SUFFIX=$(date +%s)

cat <<JSON | curl -i -X POST "$BASE_URL/coupons" \
  -H "content-type: application/json" \
  -d @-
{
  "campaign": {
    "name": "Spring Wellness Campaign",
    "description": "This should not overwrite the existing campaign",
    "status": "available",
    "startTimestamp": "2026-05-01T00:00:00.000Z",
    "endTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 999
  },
  "coupon": {
    "code": "SPRING-MANUAL-$SUFFIX",
    "status": "available",
    "expirationTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 5
  }
}
JSON
```

Atteso:

- `201 Created`
- campaign restituita e' quella gia esistente.
- non viene creata una seconda `Spring Wellness Campaign`.

Verifica:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select name, count(*) from campaigns group by name having name = '\''Spring Wellness Campaign'\'';"'
```

Atteso:

```text
Spring Wellness Campaign | 1
```

### 5.3 Duplicate coupon code

```bash
cat <<'JSON' | curl -i -X POST "$BASE_URL/coupons" \
  -H "content-type: application/json" \
  -d @-
{
  "campaign": {
    "name": "Spring Wellness Campaign",
    "description": "Existing campaign",
    "status": "available",
    "startTimestamp": "2026-05-01T00:00:00.000Z",
    "endTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 100
  },
  "coupon": {
    "code": "SPRING10",
    "status": "available",
    "expirationTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 5
  }
}
JSON
```

Atteso:

```text
409 Conflict
COUPON_ALREADY_EXISTS
```

### 5.4 Nuova campaign scaduta

```bash
export SUFFIX=$(date +%s)

cat <<JSON | curl -i -X POST "$BASE_URL/coupons" \
  -H "content-type: application/json" \
  -d @-
{
  "campaign": {
    "name": "Expired Manual Campaign $SUFFIX",
    "description": "Should be rejected",
    "status": "available",
    "startTimestamp": "2026-01-01T00:00:00.000Z",
    "endTimestamp": "2026-01-02T00:00:00.000Z",
    "maxRedemptions": 10
  },
  "coupon": {
    "code": "EXPIRED-MANUAL-$SUFFIX",
    "status": "available",
    "expirationTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 3
  }
}
JSON
```

Atteso:

```text
409 Conflict
CAMPAIGN_EXPIRED
```

Verifica rollback: la campaign non deve esistere.

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select name from campaigns where name like '\''Expired Manual Campaign%'\'';"'
```

### 5.5 Finestra temporale invalida

```bash
export SUFFIX=$(date +%s)

cat <<JSON | curl -i -X POST "$BASE_URL/coupons" \
  -H "content-type: application/json" \
  -d @-
{
  "campaign": {
    "name": "Invalid Window $SUFFIX",
    "description": "end before start",
    "status": "available",
    "startTimestamp": "2026-12-31T23:59:59.000Z",
    "endTimestamp": "2026-05-01T00:00:00.000Z",
    "maxRedemptions": 10
  },
  "coupon": {
    "code": "INVALID-WINDOW-$SUFFIX",
    "status": "available",
    "expirationTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 3
  }
}
JSON
```

Atteso:

```text
400 Bad Request
VALIDATION_ERROR
```

### 5.6 Status invalido

```bash
export SUFFIX=$(date +%s)

cat <<JSON | curl -i -X POST "$BASE_URL/coupons" \
  -H "content-type: application/json" \
  -d @-
{
  "campaign": {
    "name": "Invalid Status $SUFFIX",
    "description": "invalid status",
    "status": "enabled",
    "startTimestamp": "2026-05-01T00:00:00.000Z",
    "endTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 10
  },
  "coupon": {
    "code": "INVALID-STATUS-$SUFFIX",
    "status": "available",
    "expirationTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 3
  }
}
JSON
```

Atteso:

```text
400 Bad Request
VALIDATION_ERROR
```

### 5.7 Name vuoto

```bash
cat <<'JSON' | curl -i -X POST "$BASE_URL/coupons" \
  -H "content-type: application/json" \
  -d @-
{
  "campaign": {
    "name": "   ",
    "description": "blank name",
    "status": "available",
    "startTimestamp": "2026-05-01T00:00:00.000Z",
    "endTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 10
  },
  "coupon": {
    "code": "BLANK-NAME",
    "status": "available",
    "expirationTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 3
  }
}
JSON
```

Atteso:

```text
400 Bad Request
VALIDATION_ERROR
```

### 5.8 Coupon con expiration e maxRedemptions null

```bash
export SUFFIX=$(date +%s)

cat <<JSON | curl -i -X POST "$BASE_URL/coupons" \
  -H "content-type: application/json" \
  -d @-
{
  "campaign": {
    "name": "Unlimited Campaign $SUFFIX",
    "description": null,
    "status": "available",
    "startTimestamp": "2026-05-01T00:00:00.000Z",
    "endTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": null
  },
  "coupon": {
    "code": "UNLIMITED-$SUFFIX",
    "status": "available",
    "expirationTimestamp": null,
    "maxRedemptions": null
  }
}
JSON
```

Atteso:

```text
201 Created
```

## 6. Redeem Flow

Per questi flow conviene ripartire pulito:

```bash
docker compose down -v
docker compose up -d --build
export BASE_URL=http://localhost:3000
export ALICE_ID=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "select id from users where email = '\''alice@example.com'\'';"')
export BOB_ID=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "select id from users where email = '\''bob@example.com'\'';"')
```

### 6.1 Happy path

```bash
curl -i -X POST "$BASE_URL/coupons/SPRING10/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$ALICE_ID\"}"
```

Atteso:

```text
201 Created
```

Verifica counters:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select code, redemptions_count from coupons where code = '\''SPRING10'\''; select name, redemptions_count from campaigns where name = '\''Spring Wellness Campaign'\''; select count(*) from redemptions;"'
```

Atteso:

```text
SPRING10 redemptions_count = 1
Spring Wellness Campaign redemptions_count = 1
redemptions count = 1
```

### 6.2 Double redemption stesso utente

```bash
curl -i -X POST "$BASE_URL/coupons/SPRING10/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$ALICE_ID\"}"
```

Atteso:

```text
409 Conflict
COUPON_ALREADY_REDEEMED
```

### 6.3 Coupon inesistente

```bash
curl -i -X POST "$BASE_URL/coupons/DOES-NOT-EXIST/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$ALICE_ID\"}"
```

Atteso:

```text
404 Not Found
COUPON_NOT_FOUND
```

### 6.4 User inesistente ma UUID valido

```bash
curl -i -X POST "$BASE_URL/coupons/SPRING10/redeem" \
  -H "content-type: application/json" \
  -d '{"userId":"00000000-0000-4000-8000-000000000000"}'
```

Atteso:

```text
404 Not Found
USER_NOT_FOUND
```

### 6.5 User id invalido

```bash
curl -i -X POST "$BASE_URL/coupons/SPRING10/redeem" \
  -H "content-type: application/json" \
  -d '{"userId":"not-a-uuid"}'
```

Atteso:

```text
400 Bad Request
VALIDATION_ERROR
```

### 6.6 Campaign futura

```bash
curl -i -X POST "$BASE_URL/coupons/FUTURE10/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$ALICE_ID\"}"
```

Atteso:

```text
409 Conflict
CAMPAIGN_NOT_STARTED
```

### 6.7 Coupon scaduto

```bash
curl -i -X POST "$BASE_URL/coupons/EXPIRED-COUPON/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$ALICE_ID\"}"
```

Atteso:

```text
409 Conflict
COUPON_EXPIRED
```

### 6.8 Campaign scaduta

```bash
curl -i -X POST "$BASE_URL/coupons/EXPIRED-CAMPAIGN/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$ALICE_ID\"}"
```

Atteso:

```text
409 Conflict
CAMPAIGN_EXPIRED
```

### 6.9 Coupon not-available

```bash
curl -i -X POST "$BASE_URL/coupons/PAUSED10/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$ALICE_ID\"}"
```

Atteso:

```text
409 Conflict
COUPON_NOT_AVAILABLE
```

### 6.10 Coupon limit

Riparti pulito prima di questo test:

```bash
docker compose down -v
docker compose up -d --build
export BASE_URL=http://localhost:3000
export ALICE_ID=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "select id from users where email = '\''alice@example.com'\'';"')
export BOB_ID=$(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "select id from users where email = '\''bob@example.com'\'';"')
```

Primo redeem:

```bash
curl -i -X POST "$BASE_URL/coupons/ONE-SLOT/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$ALICE_ID\"}"
```

Atteso:

```text
201 Created
```

Secondo redeem di altro utente:

```bash
curl -i -X POST "$BASE_URL/coupons/ONE-SLOT/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$BOB_ID\"}"
```

Atteso:

```text
409 Conflict
COUPON_REDEMPTION_LIMIT_REACHED
```

### 6.11 Campaign limit

Crea una campaign con limite totale 1 e due coupon sotto la stessa campaign.

```bash
export SUFFIX=$(date +%s)

cat <<JSON | curl -i -X POST "$BASE_URL/coupons" \
  -H "content-type: application/json" \
  -d @-
{
  "campaign": {
    "name": "Campaign Limit $SUFFIX",
    "description": "Only one redemption across all coupons",
    "status": "available",
    "startTimestamp": "2026-05-01T00:00:00.000Z",
    "endTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 1
  },
  "coupon": {
    "code": "CAMP-LIMIT-A-$SUFFIX",
    "status": "available",
    "expirationTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": null
  }
}
JSON

cat <<JSON | curl -i -X POST "$BASE_URL/coupons" \
  -H "content-type: application/json" \
  -d @-
{
  "campaign": {
    "name": "Campaign Limit $SUFFIX",
    "description": "Should reuse existing campaign",
    "status": "available",
    "startTimestamp": "2026-05-01T00:00:00.000Z",
    "endTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": 1
  },
  "coupon": {
    "code": "CAMP-LIMIT-B-$SUFFIX",
    "status": "available",
    "expirationTimestamp": "2026-12-31T23:59:59.000Z",
    "maxRedemptions": null
  }
}
JSON
```

Redeem primo coupon:

```bash
curl -i -X POST "$BASE_URL/coupons/CAMP-LIMIT-A-$SUFFIX/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$ALICE_ID\"}"
```

Atteso:

```text
201 Created
```

Redeem secondo coupon nella stessa campaign:

```bash
curl -i -X POST "$BASE_URL/coupons/CAMP-LIMIT-B-$SUFFIX/redeem" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"$BOB_ID\"}"
```

Atteso:

```text
409 Conflict
CAMPAIGN_REDEMPTION_LIMIT_REACHED
```

## 7. Manual Concurrency Smoke

Questo non sostituisce i test automatizzati della Part C, ma aiuta a vedere il comportamento.

Riparti pulito:

```bash
docker compose down -v
docker compose up -d --build
export BASE_URL=http://localhost:3000
```

Crea 10 utenti temporanei:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "
insert into users (email, role)
select '\''parallel-user-'\'' || gs || '\''@example.com'\'', '\''user'\''
from generate_series(1, 10) gs
on conflict (email) do update set email = excluded.email
returning id;
"' > /tmp/parallel-user-ids.txt

cat /tmp/parallel-user-ids.txt
```

Lancia 10 redeem paralleli su `ONE-SLOT`, che ha un solo slot:

```bash
rm -f /tmp/redeem-status-*.txt

i=0
while read -r USER_ID; do
  i=$((i + 1))
  (
    curl -s -o "/tmp/redeem-body-$i.json" \
      -w "%{http_code}\n" \
      -X POST "$BASE_URL/coupons/ONE-SLOT/redeem" \
      -H "content-type: application/json" \
      -d "{\"userId\":\"$USER_ID\"}" > "/tmp/redeem-status-$i.txt"
  ) &
done < /tmp/parallel-user-ids.txt

wait

cat /tmp/redeem-status-*.txt | sort | uniq -c
```

Atteso:

```text
1 201
9 409
```

Verifica DB:

```bash
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select code, redemptions_count from coupons where code = '\''ONE-SLOT'\''; select count(*) from redemptions r join coupons c on c.id = r.coupon_id where c.code = '\''ONE-SLOT'\'';"'
```

Atteso:

```text
ONE-SLOT redemptions_count = 1
redemptions for ONE-SLOT = 1
```

## 8. Logs Durante I Test

```bash
docker compose logs -f api
```

In un altro terminale, lancia curl e controlla status code e response time.

## 9. Stop

Ferma i servizi senza cancellare dati:

```bash
docker compose down
```

Ferma e cancella dati:

```bash
docker compose down -v
```
