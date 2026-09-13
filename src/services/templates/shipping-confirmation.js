'use strict';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderShippingConfirmationHtml(variables) {
  const value = (key) => escapeHtml(variables[key]);
  const trackingButton = variables.TRACKING_URL
    ? `<a href="${value('TRACKING_URL')}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 24px;border-radius:12px;">Track your package</a>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your order is on the way</title></head>
  <body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;overflow:hidden;">
          <tr><td style="background:#111827;padding:24px 32px;">
            <table role="presentation" width="100%"><tr>
              <td><span style="display:inline-block;background:#a5f3fc;color:#111827;font-weight:900;font-size:17px;padding:9px 10px;border-radius:10px;">CP</span></td>
              <td align="right" style="color:#cbd5e1;font-size:14px;">Order ${value('ORDER_NUMBER')}</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:40px 32px 24px;">
            <div style="font-size:34px;line-height:1;margin-bottom:20px;">📦</div>
            <h1 style="margin:0 0 12px;font-size:28px;line-height:1.25;color:#111827;">Your order is on the way!</h1>
            <p style="margin:0;color:#64748b;font-size:16px;line-height:1.65;">Hi ${value('CUSTOMER_NAME')}, your Chick &amp; Piggy order has shipped and is making its way to you.</p>
          </td></tr>
          <tr><td style="padding:0 32px 28px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:16px;">
              <tr><td style="padding:22px;">
                <p style="margin:0 0 6px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Carrier</p>
                <p style="margin:0 0 18px;color:#0f172a;font-size:17px;font-weight:700;">${value('CARRIER')}</p>
                <p style="margin:0 0 6px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">Tracking number</p>
                <p style="margin:0;color:#0f172a;font-size:18px;font-weight:700;word-break:break-all;">${value('TRACKING_NUMBER')}</p>
              </td></tr>
            </table>
          </td></tr>
          ${trackingButton ? `<tr><td align="center" style="padding:0 32px 32px;">${trackingButton}</td></tr>` : ''}
          <tr><td style="padding:0 32px 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e5e7eb;">
              <tr><td style="padding-top:22px;color:#64748b;font-size:14px;line-height:1.6;">
                <strong style="color:#334155;">Shipping to</strong><br>${value('SHIPPING_ADDRESS')}<br><br>
                <strong style="color:#334155;">Shipped</strong><br>${value('SHIPPED_AT')}
              </td></tr>
            </table>
          </td></tr>
          <tr><td style="background:#f8fafc;padding:22px 32px;color:#64748b;font-size:13px;line-height:1.6;text-align:center;">
            Questions about your order? Contact us at <a href="mailto:${value('CONTACT_EMAIL')}" style="color:#0e7490;">${value('CONTACT_EMAIL')}</a>.<br>
            Chick &amp; Piggy
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderShippingConfirmationText(variables) {
  return [
    `Hi ${variables.CUSTOMER_NAME || ''},`,
    '',
    `Your Chick & Piggy order ${variables.ORDER_NUMBER || ''} is on the way.`,
    `Carrier: ${variables.CARRIER || ''}`,
    `Tracking number: ${variables.TRACKING_NUMBER || ''}`,
    variables.TRACKING_URL ? `Track your package: ${variables.TRACKING_URL}` : '',
    `Shipping to: ${variables.SHIPPING_ADDRESS || ''}`,
    `Shipped: ${variables.SHIPPED_AT || ''}`,
    '',
    `Questions? ${variables.CONTACT_EMAIL || ''}`,
  ].filter((line) => line !== '').join('\n');
}

module.exports = {
  escapeHtml,
  renderShippingConfirmationHtml,
  renderShippingConfirmationText,
};
