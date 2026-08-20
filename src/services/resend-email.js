'use strict';

const RESEND_API_URL = 'https://api.resend.com/emails';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRecipients(value) {
  const recipients = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      recipients
        .map((recipient) => normalizeEmail(recipient))
        .filter(Boolean)
    )
  );
}

function buildHeaders({ apiKey, idempotencyKey }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  return headers;
}

function buildPayload({ from, to, templateId, variables, subject, replyTo, tags }) {
  const payload = {
    from,
    to,
    template: {
      id: templateId,
      variables,
    },
  };

  if (subject) {
    payload.subject = subject;
  }

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  if (Array.isArray(tags) && tags.length > 0) {
    payload.tags = tags;
  }

  return payload;
}

function getConfig() {
  return {
    apiKey: String(process.env.RESEND_API_KEY || '').trim(),
    from: String(process.env.RESEND_FROM_EMAIL || '').trim(),
    replyTo: String(process.env.RESEND_REPLY_TO_EMAIL || '').trim(),
  };
}

async function parseResponse(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

async function sendTemplateEmail({
  to,
  templateId,
  variables = {},
  from,
  subject,
  replyTo,
  idempotencyKey,
  tags = [],
}) {
  const recipients = normalizeRecipients(to);
  const config = getConfig();
  const sender = String(from || config.from || '').trim();
  const resolvedTemplateId = String(templateId || '').trim();
  const resolvedReplyTo = String(replyTo || config.replyTo || '').trim();

  if (!config.apiKey) {
    return { skipped: true, reason: 'missing_resend_api_key' };
  }

  if (!sender) {
    return { skipped: true, reason: 'missing_resend_from_email' };
  }

  if (!resolvedTemplateId) {
    return { skipped: true, reason: 'missing_resend_template_id' };
  }

  if (recipients.length === 0) {
    return { skipped: true, reason: 'missing_recipient' };
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: buildHeaders({
      apiKey: config.apiKey,
      idempotencyKey,
    }),
    body: JSON.stringify(
      buildPayload({
        from: sender,
        to: recipients,
        templateId: resolvedTemplateId,
        variables,
        subject,
        replyTo: resolvedReplyTo,
        tags,
      })
    ),
  });

  const body = await parseResponse(response);
  if (!response.ok) {
    const err = new Error(`Resend request failed with status ${response.status}`);
    err.status = response.status;
    err.details = body;
    throw err;
  }

  return {
    skipped: false,
    id: body?.id || null,
    body,
    to: recipients,
    templateId: resolvedTemplateId,
  };
}

module.exports = {
  normalizeEmail,
  normalizeRecipients,
  sendTemplateEmail,
};
