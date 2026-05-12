CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    start_timestamp TIMESTAMPTZ NOT NULL,
    end_timestamp TIMESTAMPTZ NOT NULL,
    max_redemptions INTEGER,
    redemptions_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT campaigns_name_unique UNIQUE (name),
    CONSTRAINT campaigns_name_not_blank CHECK (btrim(name) <> ''),
    CONSTRAINT campaigns_status_check CHECK (status IN ('available', 'not-available')),
    CONSTRAINT campaigns_time_window_check CHECK (end_timestamp >= start_timestamp),
    CONSTRAINT campaigns_max_redemptions_check CHECK (
        max_redemptions IS NULL OR max_redemptions >= 0
    ),
    CONSTRAINT campaigns_redemptions_count_check CHECK (redemptions_count >= 0),
    CONSTRAINT campaigns_redemptions_limit_check CHECK (
        max_redemptions IS NULL OR redemptions_count <= max_redemptions
    )
);

CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL,
    status TEXT NOT NULL,
    expiration_timestamp TIMESTAMPTZ,
    max_redemptions INTEGER,
    redemptions_count INTEGER NOT NULL DEFAULT 0,
    campaign_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT coupons_code_unique UNIQUE (code),
    CONSTRAINT coupons_code_not_blank CHECK (btrim(code) <> ''),
    CONSTRAINT coupons_status_check CHECK (status IN ('available', 'not-available')),
    CONSTRAINT coupons_max_redemptions_check CHECK (
        max_redemptions IS NULL OR max_redemptions >= 0
    ),
    CONSTRAINT coupons_redemptions_count_check CHECK (redemptions_count >= 0),
    CONSTRAINT coupons_redemptions_limit_check CHECK (
        max_redemptions IS NULL OR redemptions_count <= max_redemptions
    ),
    CONSTRAINT coupons_campaign_id_fk FOREIGN KEY (campaign_id)
        REFERENCES campaigns (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_not_blank CHECK (btrim(email) <> ''),
    CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))
);

CREATE TABLE IF NOT EXISTS redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    coupon_id UUID NOT NULL,
    redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT redemptions_user_coupon_unique UNIQUE (user_id, coupon_id),
    CONSTRAINT redemptions_user_id_fk FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT redemptions_coupon_id_fk FOREIGN KEY (coupon_id)
        REFERENCES coupons (id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS campaigns_listing_idx
    ON campaigns (status, end_timestamp, start_timestamp, name);

CREATE INDEX IF NOT EXISTS coupons_campaign_id_idx
    ON coupons (campaign_id);

CREATE INDEX IF NOT EXISTS coupons_listing_idx
    ON coupons (status, expiration_timestamp, code);

CREATE INDEX IF NOT EXISTS redemptions_coupon_id_idx
    ON redemptions (coupon_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS campaigns_set_updated_at ON campaigns;
CREATE TRIGGER campaigns_set_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS coupons_set_updated_at ON coupons;
CREATE TRIGGER coupons_set_updated_at
    BEFORE UPDATE ON coupons
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
