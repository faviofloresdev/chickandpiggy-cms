module.exports = ({ env }) => {
  const r2PublicHost = env('CF_R2_PUBLIC_URL', '').replace(/^https?:\/\//, '');
  const allowedOrigins = Array.from(
    new Set(
      [
        env('PUBLIC_API_ALLOWED_ORIGINS', ''),
        env('FRONTEND_URL', ''),
        env('CLIENT_URL', ''),
        env('STORE_URL', ''),
        env('APP_URL', ''),
      ]
        .flatMap((entry) => String(entry || '').split(','))
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );

  return [
    'strapi::logger',
    'strapi::errors',
    {
      name: 'strapi::security',
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            'connect-src': ["'self'", 'https:'],
            'img-src': [
              "'self'",
              'data:',
              'blob:',
              'market-assets.strapi.io',
              r2PublicHost,
            ],
            'media-src': [
              "'self'",
              'data:',
              'blob:',
              'market-assets.strapi.io',
              r2PublicHost,
            ],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    {
      name: 'strapi::cors',
      config: {
        origin: (ctx) => {
          const requestOrigin = ctx.get('origin');
          if (!requestOrigin) {
            return '';
          }

          return allowedOrigins.includes(requestOrigin) ? requestOrigin : '';
        },
        credentials: false,
        headers: ['Content-Type', 'Authorization', 'Stripe-Signature', 'X-Internal-Api-Key'],
        methods: ['GET', 'POST', 'OPTIONS'],
        keepHeadersOnError: true,
      },
    },
    'global::public-api-guard',
    'global::checkout-compression',
    'strapi::poweredBy',
    'strapi::query',
    {
      name: 'strapi::body',
      config: {
        includeUnparsed: true,
      },
    },
    'strapi::session',
    'strapi::favicon',
    'strapi::public',
  ];
};
