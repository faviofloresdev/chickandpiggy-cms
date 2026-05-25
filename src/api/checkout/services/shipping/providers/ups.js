const { normalizeRate } = require('../../../utils/normalizeCarrier');
const { getCachedToken, postForm, postJson } = require('../carrierHttp');
const { buildPackageFromItems } = require('../packageBuilder');

function getConfig() {
  const useSandbox = process.env.UPS_USE_SANDBOX !== 'false';
  const baseUrl = process.env.UPS_BASE_URL || (useSandbox ? 'https://wwwcie.ups.com' : 'https://onlinetools.ups.com');
  return {
    clientId: process.env.UPS_CLIENT_ID || process.env.UPS_API_KEY,
    clientSecret: process.env.UPS_CLIENT_SECRET || process.env.UPS_API_SECRET,
    shipperNumber: process.env.UPS_ACCOUNT_NUMBER || process.env.UPS_SHIPPER_NUMBER || '',
    tokenUrl: process.env.UPS_TOKEN_URL || `${baseUrl}/security/v1/oauth/token`,
    ratingUrl: process.env.UPS_RATING_URL || `${baseUrl}/api/rating/v1/Shop`,
    merchantId: process.env.UPS_MERCHANT_ID || '',
  };
}

async function getAccessToken(config) {
  if (!config.clientId || !config.clientSecret) {
    throw new Error('UPS credentials missing');
  }

  return getCachedToken(`ups:${config.clientId}`, async () => {
    const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    return postForm(
      config.tokenUrl,
      { grant_type: 'client_credentials' },
      {
        headers: {
          Authorization: `Basic ${auth}`,
          ...(config.merchantId ? { 'x-merchant-id': config.merchantId } : {}),
        },
      }
    );
  });
}

function buildRequest({ origin, destination, items, shipperNumber }) {
  const parcel = buildPackageFromItems(items);

  return {
    RateRequest: {
      Request: {
        TransactionReference: {
          CustomerContext: 'checkout-quote',
        },
      },
      Shipment: {
        Shipper: {
          Name: process.env.SHIPPING_ORIGIN_LABEL || 'Origin',
          ShipperNumber: shipperNumber || undefined,
          Address: {
            City: origin.city,
            StateProvinceCode: origin.state,
            PostalCode: origin.postalCode,
            CountryCode: origin.country,
          },
        },
        ShipFrom: {
          Name: process.env.SHIPPING_ORIGIN_LABEL || 'Origin',
          Address: {
            City: origin.city,
            StateProvinceCode: origin.state,
            PostalCode: origin.postalCode,
            CountryCode: origin.country,
          },
        },
        ShipTo: {
          Name: 'Customer',
          Address: {
            City: destination.city,
            StateProvinceCode: destination.state,
            PostalCode: destination.postalCode,
            CountryCode: destination.country,
            ResidentialAddressIndicator: 'Y',
          },
        },
        PaymentDetails: shipperNumber
          ? {
              ShipmentCharge: [
                {
                  Type: '01',
                  BillShipper: {
                    AccountNumber: shipperNumber,
                  },
                },
              ],
            }
          : undefined,
        Service: undefined,
        PickupType: {
          Code: process.env.UPS_PICKUP_TYPE_CODE || '01',
        },
        PackagingType: {
          Code: process.env.UPS_PACKAGING_TYPE_CODE || '02',
        },
        ShipmentRatingOptions: {
          NegotiatedRatesIndicator: shipperNumber ? 'Y' : undefined,
        },
        NumOfPieces: '1',
        Package: [
          {
            PackagingType: {
              Code: process.env.UPS_PACKAGING_TYPE_CODE || '02',
            },
            Dimensions: {
              UnitOfMeasurement: {
                Code: parcel.dimensionUnit,
              },
              Length: String(Math.round(parcel.length)),
              Width: String(Math.round(parcel.width)),
              Height: String(Math.round(parcel.height)),
            },
            PackageWeight: {
              UnitOfMeasurement: {
                Code: parcel.weightUnit === 'LB' ? 'LBS' : parcel.weightUnit,
              },
              Weight: String(parcel.weight),
            },
          },
        ],
      },
    },
  };
}

function summarizeShipment({ origin, destination, payload }) {
  const pkg = payload?.RateRequest?.Shipment?.Package?.[0];
  return {
    origin: `${origin.country}-${origin.postalCode}-${origin.state}`,
    destination: `${destination.country}-${destination.postalCode}-${destination.state}`,
    shipperNumberPresent: Boolean(payload?.RateRequest?.Shipment?.Shipper?.ShipperNumber),
    weight: pkg?.PackageWeight?.Weight || null,
    weightUnit: pkg?.PackageWeight?.UnitOfMeasurement?.Code || null,
    dimensions: pkg?.Dimensions
      ? `${pkg.Dimensions.Length}x${pkg.Dimensions.Width}x${pkg.Dimensions.Height} ${pkg.Dimensions.UnitOfMeasurement?.Code || ''}`.trim()
      : null,
  };
}

function mapRates(response) {
  const shipments = response?.RateResponse?.RatedShipment;
  const list = Array.isArray(shipments) ? shipments : shipments ? [shipments] : [];

  return list
    .map((shipment) => {
      const negotiated = Number(shipment?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue);
      const published = Number(shipment?.TotalCharges?.MonetaryValue);
      const amount = Number.isFinite(negotiated) ? negotiated : published;

      if (!Number.isFinite(amount)) {
        return null;
      }

      const serviceCode = String(shipment?.Service?.Code || 'service').toLowerCase();
      const service = shipment?.Service?.Description || shipment?.RatedShipmentAlert?.Description || serviceCode.toUpperCase();
      const estimatedDays = Number(shipment?.GuaranteedDelivery?.BusinessDaysInTransit);

      return normalizeRate({
        id: `ups_${serviceCode}`,
        carrier: 'UPS',
        service,
        amount,
        estimatedDays: Number.isFinite(estimatedDays) ? estimatedDays : null,
      });
    })
    .filter(Boolean);
}

module.exports = {
  name: 'UPS',
  isConfigured() {
    const config = getConfig();
    return Boolean(config.clientId && config.clientSecret);
  },

  async getRates({ origin, destination, items }) {
    const config = getConfig();
    const token = await getAccessToken(config);
    const payload = buildRequest({ origin, destination, items, shipperNumber: config.shipperNumber });
    const shipmentSummary = summarizeShipment({ origin, destination, payload });

    strapi.log.info(`UPS rating request. shipment=${JSON.stringify(shipmentSummary)}`);

    const response = await postJson(config.ratingUrl, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        transId: `checkout-${Date.now()}`,
        transactionSrc: 'chickandpiggy-cms',
      },
      retryKey: 'ups-rates',
    });

    const shipments = response?.RateResponse?.RatedShipment;
    const shipmentList = Array.isArray(shipments) ? shipments : shipments ? [shipments] : [];
    const hasNegotiatedRates = shipmentList.some((shipment) =>
      Number.isFinite(Number(shipment?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue))
    );

    strapi.log.info(
      `UPS rating response received. negotiatedRates=${hasNegotiatedRates} shipments=${shipmentList.length}`
    );

    const rates = mapRates(response);
    if (rates.length === 0) {
      throw new Error('UPS returned no rates');
    }

    return rates;
  },
};
