const { normalizeRate } = require('../../../utils/normalizeCarrier');
const { getCachedMetadata, getCachedToken, getJson, postJson } = require('../carrierHttp');
const { buildPackageFromItems } = require('../packageBuilder');

function getConfig() {
  const useSandbox = process.env.USPS_USE_SANDBOX === 'true';
  const baseUrl = process.env.USPS_BASE_URL || (useSandbox ? 'https://apis-tem.usps.com' : 'https://apis.usps.com');
  return {
    clientId: process.env.USPS_CLIENT_ID || process.env.USPS_API_KEY,
    clientSecret: process.env.USPS_CLIENT_SECRET || process.env.USPS_API_SECRET,
    tokenUrl: process.env.USPS_TOKEN_URL || `${baseUrl}/oauth2/v3/token`,
    ratesUrl: process.env.USPS_RATES_URL || `${baseUrl}/prices/v3/base-rates-list/search`,
    standardsUrl: process.env.USPS_STANDARDS_URL || `${baseUrl}/service-standards/v3/standards`,
    rateHolderCRID: process.env.USPS_RATE_HOLDER_CRID || process.env.USPS_CRID || '',
    priceType: process.env.USPS_PRICE_TYPE || 'RETAIL',
    mailingDate: process.env.USPS_MAILING_DATE || new Date().toISOString().slice(0, 10),
  };
}

async function getAccessToken(config) {
  if (!config.clientId || !config.clientSecret) {
    throw new Error('USPS credentials missing');
  }

  return getCachedToken(`usps:${config.clientId}`, async () => {
    return postJson(config.tokenUrl, {
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });
  });
}

function buildRatesRequest({ origin, destination, items, config }) {
  const parcel = buildPackageFromItems(items);
  return {
    originZIPCode: origin.postalCode,
    destinationZIPCode: destination.postalCode,
    weight: parcel.weight,
    weightUOM: 'LB',
    length: parcel.length,
    width: parcel.width,
    height: parcel.height,
    dimensionsUOM: 'IN',
    mailingDate: config.mailingDate,
    priceType: config.priceType,
    processingCategory: process.env.USPS_PROCESSING_CATEGORY || 'MACHINABLE',
    destinationEntryFacilityType: process.env.USPS_DESTINATION_ENTRY_FACILITY_TYPE || 'NONE',
    mailingShape: process.env.USPS_MAILING_SHAPE || 'PACKAGE',
    ...(config.rateHolderCRID ? { rateHolderCRID: config.rateHolderCRID } : {}),
  };
}

async function getTransitDays({ origin, destination, parcel, token, config }) {
  const metadataCacheKey = [
    'usps-standards',
    origin.postalCode,
    destination.postalCode,
    parcel.mailClass,
    parcel.weight,
    parcel.length,
    parcel.width,
    parcel.height,
  ].join(':');

  const standards = await getCachedMetadata(metadataCacheKey, async () =>
    getJson(config.standardsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      query: {
        originZIPCode: origin.postalCode,
        destinationZIPCode: destination.postalCode,
        mailClass: parcel.mailClass,
        weight: parcel.weight,
        length: parcel.length,
        width: parcel.width,
        height: parcel.height,
        dimensionsUOM: 'in',
        weightUOM: 'lb',
        ...(config.rateHolderCRID ? { rateHolderCRID: config.rateHolderCRID } : {}),
      },
      retryKey: 'usps-standards',
    }).catch(() => [])
  );

  const entries = Array.isArray(standards) ? standards : [];
  const match = entries.find((entry) => entry?.mailClass === parcel.mailClass);
  const days = Number(match?.days);
  return Number.isFinite(days) ? days : null;
}

function mapMailClass(parcel) {
  const service = String(parcel?.mailClass || 'USPS_GROUND_ADVANTAGE');
  return service
    .toLowerCase()
    .replace(/_+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getAllowedMailClasses() {
  const configured = String(
    process.env.USPS_ALLOWED_MAIL_CLASSES || 'USPS_GROUND_ADVANTAGE,PRIORITY_MAIL,PRIORITY_MAIL_EXPRESS'
  );

  return new Set(
    configured
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );
}

async function mapRates(response, { origin, destination, token, config, items }) {
  const requestParcel = buildPackageFromItems(items);
  const rateOptions = Array.isArray(response?.rateOptions) ? response.rateOptions : [];
  const flatRates = Array.isArray(response?.rates) ? response.rates : [];
  const rates = rateOptions.flatMap((option) => (Array.isArray(option?.rates) ? option.rates : []));
  const combinedRates = rates.length > 0 ? rates : flatRates;
  const totalBasePrice = Number(response?.totalBasePrice ?? response?.rateOptions?.[0]?.totalBasePrice);
  const allowedMailClasses = getAllowedMailClasses();

  if (combinedRates.length === 0 && Number.isFinite(totalBasePrice)) {
    const estimatedDays = await getTransitDays({
      origin,
      destination,
      token,
      config,
      parcel: {
        ...requestParcel,
        mailClass: 'USPS_GROUND_ADVANTAGE',
      },
    });

    return [
      normalizeRate({
        id: 'usps_ground_advantage',
        carrier: 'USPS',
        service: 'Ground Advantage',
        amount: totalBasePrice,
        estimatedDays,
      }),
    ];
  }

  const normalized = [];
  for (const rate of combinedRates) {
    const amount = Number(rate?.price);
    if (!Number.isFinite(amount)) {
      continue;
    }

    const mailClass = String(rate?.mailClass || 'USPS_GROUND_ADVANTAGE');
    if (!allowedMailClasses.has(mailClass.toUpperCase())) {
      continue;
    }

    const estimatedDays = await getTransitDays({
      origin,
      destination,
      token,
      config,
      parcel: {
        ...requestParcel,
        mailClass,
      },
    });

    normalized.push(
      normalizeRate({
        id: `usps_${mailClass.toLowerCase()}`,
        carrier: 'USPS',
        service: mapMailClass(rate),
        amount,
        estimatedDays,
      })
    );
  }

  return normalized;
}

module.exports = {
  name: 'USPS',
  isConfigured() {
    const config = getConfig();
    return Boolean(config.clientId && config.clientSecret);
  },

  async getRates({ origin, destination, items }) {
    const config = getConfig();
    const token = await getAccessToken(config);
    const payload = buildRatesRequest({ origin, destination, items, config });
    const response = await postJson(config.ratesUrl, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      retryKey: 'usps-rates',
    });

    const rates = await mapRates(response, { origin, destination, token, config, items });
    if (rates.length === 0) {
      throw new Error('USPS returned no rates');
    }

    return rates;
  },
};
