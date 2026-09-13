# Resend Templates

These templates match the variables already wired in the backend integration.

## Newsletter Contact Notification

Suggested template name:

- `newsletter-contact-notification`

Suggested subject:

- `New newsletter subscriber: {{SUBSCRIBER_EMAIL}}`

Variables:

- `CONTACT_EMAIL`
- `SUBSCRIBER_EMAIL`
- `SUBSCRIBED_AT`
- `SOURCE`
- `NOTES`
- `UNSUBSCRIBE_URL`

Target recipient:

- The `contactEmail` field from the Strapi `Contact` single type.
- The unsubscribe button is an internal management action and requires confirmation.

## Order Confirmation

Suggested template name:

- `order-confirmation`

Suggested subject:

- `Your Chick & Piggy order is confirmed`

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

## Shipping Confirmation

Suggested template name:

- `shipping-confirmation`

Suggested subject:

- `Your Chick & Piggy order {{ORDER_NUMBER}} is on the way`

Variables:

- `CONTACT_EMAIL`
- `ORDER_ID`
- `ORDER_NUMBER`
- `CUSTOMER_NAME`
- `CUSTOMER_EMAIL`
- `CARRIER`
- `TRACKING_NUMBER`
- `TRACKING_URL`
- `SHIPPED_AT`
- `SHIPPING_OPTION`
- `SHIPPING_ADDRESS`
- `ORDER_TOTAL`
- `ORDER_CURRENCY`

Target recipient:

- The customer email from the shipped order.

After publishing the template in Resend, set its id or alias as
`RESEND_SHIPPING_TEMPLATE_ID` in the backend environment.
