# Checkout module

This module implements the storefront checkout flow with server-side quotes, Stripe PaymentIntents and webhook-based order updates.

Shipping optimization guardrails
- The frontend must call only `POST /api/checkout/quote` for shipping quotes. Carrier APIs must never be called directly from the browser.
- Trigger quote requests only at checkout, never on every cart refresh, and never while the user is typing.
- Debounce address input on the client between `700ms` and `1000ms`.
- Request rates only after the full address is valid, the ZIP/postal code is complete, and cart weight/dimensions are finalized locally.
- Reuse `shippingFingerprint` and previously returned quotes whenever the package configuration has not changed.
- The backend now caches quote responses for 30 minutes and static carrier metadata for 24 hours, with in-flight request deduplication.
- Checkout responses are compressed before being returned to the frontend when the client supports `br` or `gzip`.

Env vars
- `STRIPE_SECRET_KEY` (required): Stripe server secret key.
- `STRIPE_WEBHOOK_SECRET` (required for webhook): Stripe webhook signing secret.
- `FEDEX_CLIENT_ID` / `FEDEX_CLIENT_SECRET`: FedEx OAuth credentials. `FEDEX_API_KEY` is also accepted as legacy alias for client id.
- `FEDEX_ACCOUNT_NUMBER` (optional): enables account-specific FedEx rates.
- `UPS_CLIENT_ID` / `UPS_CLIENT_SECRET`: UPS OAuth credentials. `UPS_API_KEY` is also accepted as legacy alias for client id.
- `UPS_ACCOUNT_NUMBER` or `UPS_SHIPPER_NUMBER` (optional): enables negotiated UPS rates.
- `USPS_CLIENT_ID` / `USPS_CLIENT_SECRET`: USPS OAuth credentials. `USPS_API_KEY` is also accepted as legacy alias for client id.
- `USPS_CRID` (optional): required by some USPS accounts/products.
- `*_USE_SANDBOX`, `*_TOKEN_URL`, `*_RATES_URL`, `UPS_BASE_URL`, `USPS_STANDARDS_URL` (optional): override carrier endpoints.
- `DEFAULT_PACKAGE_WEIGHT_LB`, `DEFAULT_PACKAGE_LENGTH_IN`, `DEFAULT_PACKAGE_WIDTH_IN`, `DEFAULT_PACKAGE_HEIGHT_IN` (optional): fallback parcel values when catalog items do not yet expose physical dimensions.
- `SHIPPING_ORIGIN_*`: fallback origin address and label used when no active origin exists in the CMS.
- `SHIPPING_RATE_CACHE_TTL_MS` (optional): quote cache TTL. Defaults to `1800000` (30 minutes).
- `SHIPPING_METADATA_CACHE_TTL_MS` (optional): static metadata TTL. Defaults to `86400000` (24 hours).
- `CARRIER_HTTP_TIMEOUT_MS`, `CARRIER_HTTP_MAX_RETRIES`, `CARRIER_HTTP_RETRY_BASE_MS` (optional): timeout and exponential backoff tuning for carrier requests.
- `REDIS_URL` (optional): if present and reachable, the service will prefer Redis-aware cache mode; otherwise it falls back safely to in-memory cache.
- `SHIPPING_LABEL_PROVIDER` (optional): reserved for async label creation flow, designed around Shippo/EasyPost-first integration.

API endpoints
- `POST /api/checkout/quote`: validates cart, recalculates subtotal and returns `shippingOptions`.
- `POST /api/checkout/payment-intent`: validates cart, customer and shipping, creates or updates a Stripe PaymentIntent and persists an `order`.
- `POST /api/checkout/webhook`: receives Stripe webhook events and marks orders as `paid` or `failed`.
- `POST /api/checkout/labels`: enqueues async shipping-label generation for an order and stores label status in `order.metadata.shippingLabel`.

Frontend payload
```json
{
  "items": [
    {
      "id": "12",
      "productId": "12",
      "variantId": "34",
      "quantity": 2,
      "shippingDetails": {
        "weight": 1.2,
        "weightUnit": "LB",
        "length": 8,
        "width": 6,
        "height": 2,
        "dimensionUnit": "IN"
      },
      "selectedOptions": {
        "size": "M"
      }
    }
  ],
  "customer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "555-123-4567"
  },
  "shipping": {
    "addressLine1": "123 Main St",
    "addressLine2": "Apt 4B",
    "city": "Miami",
    "state": "FL",
    "postalCode": "33101",
    "country": "US",
    "selectedShippingOptionId": "usps_ground_advantage"
  },
  "billing": {
    "addressLine1": "123 Main St",
    "city": "Miami",
    "state": "FL",
    "postalCode": "33101",
    "country": "US"
  },
  "discountCode": "SUMMER10",
  "orderId": 1,
  "paymentIntentId": "pi_123"
}
```

Quote response notes
- `shippingOptions` now contains only the deduplicated `cheapest`, `fastest` and `recommended` options.
- Each option includes a service-level `fingerprint`.
- The response includes:
  - `shippingFingerprint`: hash generated from destination ZIP, cart items, total weight and package dimensions.
  - `packageSnapshot`: normalized package input used for cache lookup.
  - `shippingHighlights`: object containing `cheapest`, `fastest` and `recommended`.
  - `shippingCacheHit`: indicates whether the quote was served from cache.

Notes
- Prices are always recalculated on the server using `product.basePrice` and `product-variant.priceOverride`.
- If `discountCode` is sent, checkout validates it against the new `discount` collection and returns the applied discount in both `quote` and `payment-intent`.
- The current `discount` model is intentionally basic: `name`, `code`, `active`, `type` and `value`.
- Discount amounts are applied before tax calculation, persisted in the order, and linked back to the `discount` entry for audit/history.
- If `variantId` is provided, the variant price is used first and the product price is the fallback.
- Orders are persisted in `api::order.order` and line items in `api::order-item.order-item`.
- Shipping origins can now be managed in the `shipping-origin` collection type. `GET /api/shipping-origins/active` returns the origin currently used by checkout and storefront display.
- The legacy `/api/stripe/checkout` and `/api/stripe/webhook` endpoints now delegate to this checkout flow for compatibility.
- Carrier adapters now call live OAuth-based APIs for FedEx, UPS and USPS when mocks are disabled.
- Carriers without valid credentials are skipped automatically and are not returned in `shippingOptions`.
- The checkout now reads `product.weight`, `product.width`, `product.height` and `product.depth` automatically for parcel calculation.
- If the storefront sends `items[].shippingDetails`, those values override the product physical attributes for that line.
- If neither product attributes nor request values are present, live rates fall back to the `DEFAULT_PACKAGE_*` env values.
- Carrier HTTP calls now include timeout protection, exponential backoff retries, duration logging, failure logging and per-carrier response timing logs.
- USPS transit-time lookups are cached as static metadata for 24 hours to reduce repeated standards API traffic.
- The quote service deduplicates concurrent requests for the same package fingerprint so checkout refresh bursts do not fan out to carriers.
- The current label queue persists lifecycle state in the order record and is intentionally structured for Shippo/EasyPost-first label purchase integration.

Next steps
- Replace the temporary tax table with Stripe Tax or another tax provider.
- Add integration tests for quote, payment-intent and webhook flows.
- Wire a concrete Shippo or EasyPost label-purchase adapter into `enqueueLabelCreation`.
