BEGIN;

INSERT INTO users (email, role)
VALUES
    ('alice@example.com', 'user'),
    ('bob@example.com', 'user'),
    ('admin@example.com', 'admin')
ON CONFLICT (email) DO NOTHING;

INSERT INTO campaigns (
    name,
    description,
    status,
    start_timestamp,
    end_timestamp,
    max_redemptions
)
VALUES
    (
        'Spring Wellness Campaign',
        'Active campaign with limited redemptions.',
        'available',
        now() - interval '1 day',
        now() + interval '30 days',
        100
    ),
    (
        'Future Nutrition Campaign',
        'Future campaign that should appear in admin listings but cannot be redeemed yet.',
        'available',
        now() + interval '7 days',
        now() + interval '37 days',
        NULL
    ),
    (
        'Expired Campaign',
        'Expired campaign used for validation checks.',
        'available',
        now() - interval '60 days',
        now() - interval '1 day',
        NULL
    ),
    (
        'Paused Campaign',
        'Campaign with not-available status.',
        'not-available',
        now() - interval '1 day',
        now() + interval '30 days',
        NULL
    )
ON CONFLICT (name) DO NOTHING;

INSERT INTO coupons (
    code,
    status,
    expiration_timestamp,
    max_redemptions,
    campaign_id
)
SELECT
    coupon.code,
    coupon.status,
    coupon.expiration_timestamp,
    coupon.max_redemptions,
    campaigns.id
FROM (
    VALUES
        (
            'SPRING10',
            'available',
            now() + interval '30 days',
            10,
            'Spring Wellness Campaign'
        ),
        (
            'ONE-SLOT',
            'available',
            now() + interval '30 days',
            1,
            'Spring Wellness Campaign'
        ),
        (
            'NO-EXPIRY',
            'available',
            NULL::timestamptz,
            NULL::integer,
            'Spring Wellness Campaign'
        ),
        (
            'FUTURE10',
            'available',
            now() + interval '37 days',
            NULL::integer,
            'Future Nutrition Campaign'
        ),
        (
            'EXPIRED-CAMPAIGN',
            'available',
            now() + interval '30 days',
            NULL::integer,
            'Expired Campaign'
        ),
        (
            'EXPIRED-COUPON',
            'available',
            now() - interval '1 day',
            NULL::integer,
            'Spring Wellness Campaign'
        ),
        (
            'PAUSED10',
            'not-available',
            now() + interval '30 days',
            NULL::integer,
            'Paused Campaign'
        )
) AS coupon (
    code,
    status,
    expiration_timestamp,
    max_redemptions,
    campaign_name
)
JOIN campaigns ON campaigns.name = coupon.campaign_name
ON CONFLICT (code) DO NOTHING;

COMMIT;
