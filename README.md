# Chick and Piggy CMS

Backend CMS and checkout API for the Chick and Piggy storefront, built with Strapi 5.

## Overview

This project manages:

- CMS content for the storefront
- Product, variant, and option data
- Checkout quotes and shipping rate selection
- Stripe PaymentIntent creation and webhook processing
- Discount validation and order persistence

## Stack

- Strapi 5
- Node.js 20+
- SQLite for local development
- Stripe for payments
- FedEx, UPS, and USPS integrations for shipping rates

## Requirements

- Node.js `20.x` to `24.x`
- npm `6+`

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template:

```bash
cp .env.example .env
```

3. Complete the values in `.env`, especially:

- `APP_KEYS`
- `API_TOKEN_SALT`
- `ADMIN_JWT_SECRET`
- `TRANSFER_TOKEN_SALT`
- `ENCRYPTION_KEY`
- `JWT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PUBLIC_API_ALLOWED_ORIGINS`
- `CHECKOUT_SESSION_SECRET`
- `CHECKOUT_INTERNAL_API_KEY`

4. Start the project in development:

```bash
npm run develop
```

The local Strapi admin usually runs at `http://localhost:1337/admin`.

## Available scripts

- `npm run develop`: start Strapi in development mode
- `npm run dev`: alias of development mode
- `npm run start`: start Strapi in production mode
- `npm run build`: build the admin panel
- `npm run console`: open the Strapi console
- `npm run seed:example`: run the example seed script
- `npm run upgrade:dry`: preview Strapi upgrade changes
- `npm run upgrade`: run the Strapi upgrade helper

## Checkout API

Main endpoints:

- `POST /api/checkout/quote`
- `POST /api/checkout/discount`
- `POST /api/checkout/payment-intent`
- `POST /api/checkout/webhook`
- `POST /api/checkout/labels`

Legacy compatibility endpoints:

- `POST /api/stripe/checkout`
- `POST /api/stripe/webhook`

Additional implementation notes live in [src/api/checkout/README.md](src/api/checkout/README.md).

## Frontend integration note

When the frontend applies or updates a discount, it must keep reusing the same checkout session by sending back:

- `checkoutSessionToken`
- `orderId`
- `paymentIntentId`
- `discountCode`
- `shipping.selectedShippingOptionId`

The frontend must obtain `checkoutSessionToken` from `POST /api/checkout/quote` and send it back on discount application and `payment-intent`.
If the frontend recalculates checkout without `orderId` or `paymentIntentId`, it can create a new pending order instead of updating the current one.

## Environment variables

Use [`.env.example`](.env.example) as the base template. The project includes configuration for:

- Strapi server secrets
- SQLite local database
- Stripe checkout and webhook handling
- Shipping origin and shipping cache tuning
- FedEx, UPS, and USPS credentials
- Cloudflare R2 media storage
- Optional Redis-backed cache
- Explicit public API origins and internal checkout route protection
- Signed checkout sessions and endpoint exposure flags

Do not commit your real `.env` file.
Rotate any existing Strapi or Stripe secrets that were previously stored in tracked environment files.

## Cloudflare R2 uploads

This project is prepared to store media uploads in Cloudflare R2 using Strapi's official S3 upload provider.

Required variables:

- `CF_R2_ACCESS_KEY_ID`
- `CF_R2_SECRET_ACCESS_KEY`
- `CF_R2_BUCKET`
- `CF_R2_ENDPOINT`

Recommended variables:

- `CF_R2_REGION=auto`
- `CF_R2_PUBLIC_URL`
- `CF_R2_ROOT_PATH`

Example values:

```env
CF_R2_ACCESS_KEY_ID=your-access-key-id
CF_R2_SECRET_ACCESS_KEY=your-secret-access-key
CF_R2_BUCKET=chickandpiggy-media
CF_R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
CF_R2_REGION=auto
CF_R2_PUBLIC_URL=https://pub-<PUBLIC_BUCKET_ID>.r2.dev
CF_R2_ROOT_PATH=
```

Notes:

- If the R2 variables are missing, Strapi falls back to the default local upload behavior.
- `CF_R2_PUBLIC_URL` is strongly recommended so Strapi stores public asset URLs instead of internal R2 endpoint URLs.
- The admin CSP was updated so Media Library previews can load from the R2 public domain.
- You must enable public access or bind a public custom domain to the bucket if assets should be reachable from the storefront.
- You should also configure bucket CORS in Cloudflare R2.

Suggested CORS example for a public bucket:

```json
[
  {
    "AllowedOrigins": ["https://your-strapi-domain.com", "https://your-frontend-domain.com"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"]
  }
]
```

## GitHub preparation

This repository is already set up to keep common local-only files out of Git:

- `.env`
- `node_modules/`
- build caches
- local SQLite files
- generated Strapi temp files
- `public/uploads/*` except `public/uploads/.gitkeep`

Before pushing to GitHub, verify:

1. `.env` contains only local secrets and is not committed.
2. `node_modules` is not committed.
3. Uploaded media that should stay private is not tracked.
4. Your frontend or deployment platform has the same required environment variables.

## Project structure

```text
config/          Strapi configuration
database/        Database setup
public/          Public assets
scripts/         Utility and seed scripts
src/api/         Content types, controllers, routes, and services
src/components/  Reusable Strapi components
```

## License

This project includes [license.txt](license.txt).
