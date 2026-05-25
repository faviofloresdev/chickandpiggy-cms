const { normalizeRate } = require('../../../utils/normalizeCarrier');
const { getCachedToken, postForm, postJson } = require('../carrierHttp');
const { buildPackageFromItems } = require('../packageBuilder');

function getConfig() {
  const useSandbox = process.env.FEDEX_USE_SANDBOX === 'true';
  return {
    clientId: process.env.FEDEX_CLIENT_ID || process.env.FEDEX_API_KEY,
    clientSecret: process.env.FEDEX_CLIENT_SECRET || process.env.FEDEX_SECRET_KEY,
    childKey: process.env.FEDEX_CHILD_KEY || '',
    childSecret: process.env.FEDEX_CHILD_SECRET || '',
    accountNumber: process.env.FEDEX_ACCOUNT_NUMBER || '',
    tokenUrl: process.env.FEDEX_TOKEN_URL || (useSandbox ? 'https://apis-sandbox.fedex.com/oauth/token' : 'https://apis.fedex.com/oauth/token'),
    ratesUrl: process.env.FEDEX_RATES_URL || (useSandbox ? 'https://apis-sandbox.fedex.com/rate/v1/rates/quotes' : 'https://apis.fedex.com/rate/v1/rates/quotes'),
  };
}

async function getAccessToken(config) {
  if (!config.clientId || !config.clientSecret) {
    throw new Error('FedEx credentials missing');
  }

  return getCachedToken(`fedex:${config.clientId}`, async () => {
    const form = {
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    };

    if (config.childKey && config.childSecret) {
      form.child_key = config.childKey;
      form.child_secret = config.childSecret;
    }

    return postForm(config.tokenUrl, form);
  });
}

function buildRequest({ origin, destination, items, accountNumber, rateRequestType, pickupType, packagingType }) {
  const parcel = buildPackageFromItems(items);
  const request = {
    accountNumber: accountNumber ? { value: accountNumber } : undefined,
    rateRequestControlParameters: {
      rateSortOrder: 'SERVICENAMETRADITIONAL',
      returnTransitTimes: true,
      servicesNeededOnRateFailure: true,
      variableOptions: 'FREIGHT_GUARANTEE',
    },
    requestedShipment: {
      shipper: {
        address: {
          postalCode: origin.postalCode,
          countryCode: origin.country,
          stateOrProvinceCode: origin.state,
          city: origin.city,
        },
      },
      recipient: {
        address: {
          postalCode: destination.postalCode,
          countryCode: destination.country,
          stateOrProvinceCode: destination.state,
          city: destination.city,
          residential: true,
        },
      },
      pickupType: pickupType || process.env.FEDEX_PICKUP_TYPE || 'USE_SCHEDULED_PICKUP',
      packagingType: packagingType || process.env.FEDEX_PACKAGING_TYPE || 'YOUR_PACKAGING',
      rateDisplayOption: process.env.FEDEX_RATE_DISPLAY_OPTION || 'SELECTED_RATES_EXCLUDING_F1R',
      rateRequestType: rateRequestType || ['ACCOUNT', 'LIST'],
      totalPackageCount: 1,
      requestedPackageLineItems: [
        {
          groupPackageCount: 1,
          weight: {
            units: parcel.weightUnit,
            value: parcel.weight,
          },
          dimensions: {
            length: String(Math.round(parcel.length)),
            width: String(Math.round(parcel.width)),
            height: String(Math.round(parcel.height)),
            units: parcel.dimensionUnit,
          },
        },
      ],
    },
  };

  if (!request.accountNumber) {
    delete request.accountNumber;
  }

  return request;
}

function summarizeShipment({ origin, destination, payload }) {
  const pkg = payload?.requestedShipment?.requestedPackageLineItems?.[0];
  return {
    origin: `${origin.country}-${origin.postalCode}-${origin.state}`,
    destination: `${destination.country}-${destination.postalCode}-${destination.state}`,
    accountNumberPresent: Boolean(payload?.accountNumber?.value),
    weight: pkg?.weight?.value || null,
    weightUnit: pkg?.weight?.units || null,
    dimensions: pkg?.dimensions
      ? `${pkg.dimensions.length}x${pkg.dimensions.width}x${pkg.dimensions.height} ${pkg.dimensions.units}`
      : null,
  };
}

function extractAmount(detail) {
  const ratedDetails = Array.isArray(detail?.ratedShipmentDetails) ? detail.ratedShipmentDetails : [];
  const topLevelCandidates = [
    detail?.totalNetCharge,
    detail?.totalNetFedExCharge,
    detail?.totalBaseCharge,
    detail?.totalNetChargeWithDutiesAndTaxes,
  ];

  for (const candidate of topLevelCandidates) {
    const amount = Number(candidate?.amount ?? candidate);
    if (Number.isFinite(amount) && amount > 0) {
      return amount;
    }
  }

  for (const ratedDetail of ratedDetails) {
    const candidates = [
      ratedDetail?.totalNetCharge,
      ratedDetail?.totalNetFedExCharge,
      ratedDetail?.totalBaseCharge,
      ratedDetail?.netCharge,
      ratedDetail?.shipmentRateDetail?.totalNetCharge,
      ratedDetail?.shipmentRateDetail?.totalNetFedExCharge,
      ratedDetail?.shipmentRateDetail?.totalBaseCharge,
      ratedDetail?.shipmentRateDetail?.netFedExCharge,
      ratedDetail?.shipmentRateDetail?.totalSurcharges,
      ratedDetail?.shipmentRateDetail?.totalBillingWeight,
    ];

    for (const candidate of candidates) {
      const amount = Number(candidate?.amount ?? candidate);
      if (Number.isFinite(amount) && amount > 0) {
        return amount;
      }
    }
  }

  return null;
}

function extractEstimatedDays(detail) {
  const candidates = [
    detail?.commit?.transitDays,
    detail?.commit?.dateDetail?.dayFormat,
    detail?.commitDetails?.[0]?.transitDays,
  ];

  for (const candidate of candidates) {
    const amount = Number(candidate);
    if (Number.isFinite(amount) && amount > 0) {
      return amount;
    }
  }

  return null;
}

function mapRates(response) {
  const details = Array.isArray(response?.output?.rateReplyDetails) ? response.output.rateReplyDetails : [];

  return details
    .map((detail) => {
      const amount = extractAmount(detail);
      if (!Number.isFinite(amount)) {
        return null;
      }

      const serviceName = detail?.serviceName || detail?.serviceType || 'Service';
      const serviceCode = String(detail?.serviceType || serviceName).toLowerCase().replace(/[^a-z0-9]+/g, '_');

      return normalizeRate({
        id: `fedex_${serviceCode}`,
        carrier: 'FedEx',
        service: serviceName,
        amount,
        estimatedDays: extractEstimatedDays(detail),
      });
    })
    .filter(Boolean);
}

function summarizeRateReplyDetails(response) {
  const details = Array.isArray(response?.output?.rateReplyDetails) ? response.output.rateReplyDetails : [];

  return details.slice(0, 10).map((detail) => {
    const ratedDetails = Array.isArray(detail?.ratedShipmentDetails) ? detail.ratedShipmentDetails : [];
    return {
      serviceType: detail?.serviceType || null,
      serviceName: detail?.serviceName || null,
      packagingType: detail?.packagingType || null,
      ratedShipmentDetailsCount: ratedDetails.length,
      extractedAmount: extractAmount(detail),
      transitDays: extractEstimatedDays(detail),
    };
  });
}

function extractResponseIssues(response) {
  const candidates = [
    ...(Array.isArray(response?.errors) ? response.errors : []),
    ...(Array.isArray(response?.output?.errors) ? response.output.errors : []),
    ...(Array.isArray(response?.output?.alerts) ? response.output.alerts : []),
    ...(Array.isArray(response?.notifications) ? response.notifications : []),
  ];

  const messages = candidates
    .map((entry) => {
      const code = entry?.code || entry?.alertCode || entry?.messageCode || '';
      const text = entry?.message || entry?.description || entry?.localizedMessage || entry?.text || '';
      return [code, text].filter(Boolean).join(': ').trim();
    })
    .filter(Boolean);

  return Array.from(new Set(messages));
}

module.exports = {
  name: 'FedEx',
  isConfigured() {
    const config = getConfig();
    return Boolean(config.clientId && config.clientSecret);
  },

  async getRates({ origin, destination, items }) {
    const config = getConfig();
    const token = await getAccessToken(config);
    const attempts = [
      {
        name: 'account-and-list',
        payload: buildRequest({
          origin,
          destination,
          items,
          accountNumber: config.accountNumber,
          rateRequestType: config.accountNumber ? ['ACCOUNT', 'LIST'] : ['LIST'],
        }),
      },
    ];

    if (config.accountNumber) {
      attempts.push({
        name: 'list-fallback',
        payload: buildRequest({
          origin,
          destination,
          items,
          accountNumber: '',
          rateRequestType: ['LIST'],
          pickupType: process.env.FEDEX_FALLBACK_PICKUP_TYPE || 'DROPOFF_AT_FEDEX_LOCATION',
        }),
      });
    }

    let lastFailure = null;

    for (const attempt of attempts) {
      const shipmentSummary = summarizeShipment({ origin, destination, payload: attempt.payload });
      strapi.log.info(`FedEx rating request. attempt=${attempt.name} shipment=${JSON.stringify(shipmentSummary)}`);

      const response = await postJson(config.ratesUrl, attempt.payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-locale': 'en_US',
        },
        retryKey: `fedex-rates-${attempt.name}`,
      });

      const rates = mapRates(response);
      if (rates.length > 0) {
        if (attempt.name !== 'account-and-list') {
          strapi.log.warn(`FedEx rates recovered via fallback attempt=${attempt.name}`);
        }
        return rates;
      }

      const issues = extractResponseIssues(response);
      const responseSummary = summarizeRateReplyDetails(response);
      lastFailure = {
        attempt: attempt.name,
        issues,
        shipment: shipmentSummary,
        responseSummary,
      };

      strapi.log.warn(
        `FedEx returned no mapped rates. attempt=${attempt.name} shipment=${JSON.stringify(shipmentSummary)} responseSummary=${JSON.stringify(responseSummary)}`
      );
    }

    const detailParts = [
      lastFailure?.issues?.length ? `issues=${lastFailure.issues.join(' | ')}` : null,
      lastFailure?.attempt ? `attempt=${lastFailure.attempt}` : null,
      lastFailure?.shipment ? `shipment=${JSON.stringify(lastFailure.shipment)}` : null,
    ].filter(Boolean);

    const error = new Error(`FedEx returned no rates${detailParts.length ? `. ${detailParts.join(' ')}` : ''}`);
    error.details = lastFailure || {};
    throw error;
  },
};
