module.exports = ({ env }) => {
  const hasR2Config =
    env('CF_R2_ACCESS_KEY_ID') &&
    env('CF_R2_SECRET_ACCESS_KEY') &&
    env('CF_R2_BUCKET') &&
    env('CF_R2_ENDPOINT');

  if (!hasR2Config) {
    return {};
  }

  return {
    upload: {
      config: {
        provider: '@strapi/provider-upload-aws-s3',
        providerOptions: {
          baseUrl: env('CF_R2_PUBLIC_URL') || undefined,
          rootPath: env('CF_R2_ROOT_PATH') || undefined,
          s3Options: {
            accessKeyId: env('CF_R2_ACCESS_KEY_ID'),
            secretAccessKey: env('CF_R2_SECRET_ACCESS_KEY'),
            endpoint: env('CF_R2_ENDPOINT'),
            region: env('CF_R2_REGION', 'auto'),
            forcePathStyle: false,
            params: {
              Bucket: env('CF_R2_BUCKET'),
            },
          },
        },
        actionOptions: {
          upload: {},
          uploadStream: {},
          delete: {},
        },
      },
    },
  };
};
