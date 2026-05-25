module.exports = ({ env }) => {
  const r2PublicHost = env('CF_R2_PUBLIC_URL', '').replace(/^https?:\/\//, '');

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
    'strapi::cors',
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
