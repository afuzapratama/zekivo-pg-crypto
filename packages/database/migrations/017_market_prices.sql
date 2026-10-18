-- Price references only. These records do not create payment attempts or ledger credit.
CREATE TABLE market_price_cache (
 cache_key text PRIMARY KEY CHECK(cache_key ~ '^[a-f0-9]{64}$'),
 snapshot jsonb,
 fetched_at timestamptz,
 valid_until timestamptz,
 retry_after timestamptz,
 error_code text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE market_price_usage (
 cache_key text NOT NULL CHECK(cache_key ~ '^[a-f0-9]{64}$'),
 month date NOT NULL CHECK(extract(day from month)=1),
 requests integer NOT NULL CHECK(requests>0),
 PRIMARY KEY(cache_key,month)
);
