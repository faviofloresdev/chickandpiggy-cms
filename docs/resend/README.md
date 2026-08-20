# Resend Templates

These templates match the variables already wired in the backend integration.

## Newsletter Contact Notification

Suggested template name:

- `newsletter-contact-notification`

Variables:

- `CONTACT_EMAIL`
- `SUBSCRIBER_EMAIL`
- `SUBSCRIBED_AT`
- `SOURCE`
- `NOTES`

Target recipient:

- The `contactEmail` field from the Strapi `Contact` single type.

## Order Confirmation

Suggested template name:

- `order-confirmation`

Variables:

- `CONTACT_EMAIL`
- `ORDER_ID`
- `ORDER_DATE`
- `ORDER_STATUS`
- `PAYMENT_STATUS`
- `CUSTOMER_NAME`
- `CUSTOMER_EMAIL`
- `CUSTOMER_PHONE`
- `ORDER_CURRENCY`
- `ORDER_SUBTOTAL`
- `ORDER_DISCOUNT`
- `ORDER_TAX`
- `ORDER_SHIPPING`
- `ORDER_TOTAL`
- `SHIPPING_OPTION`
- `SHIPPING_ADDRESS`
- `BILLING_ADDRESS`
- `ITEM_COUNT`
- `ITEMS_SUMMARY`

Target recipient:

- The customer email from the paid order.
