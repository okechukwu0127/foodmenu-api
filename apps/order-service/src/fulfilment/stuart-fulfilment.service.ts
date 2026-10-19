import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Customer, Order, OrderItem } from "@prisma/client";

type StuartAddress = {
  city?: string;
  country?: string;
  line1?: string;
  line2?: string;
  postcode?: string;
  raw?: string;
};

type StuartContact = {
  email?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  phone?: string | null;
  company?: string | null;
};

type StuartCreateJobPayload = {
  job: {
    pickup_at?: string;
    pickups: Array<{
      address: string;
      comment?: string;
      contact: StuartContact;
    }>;
    dropoffs: Array<{
      address: string;
      client_reference: string;
      comment?: string;
      contact: StuartContact;
      package_description: string;
      package_type: string;
    }>;
  };
};

type StuartTokenResponse = {
  access_token: string;
  expires_in?: number;
  token_type?: string;
};

export type StuartDispatchOrder = Order & {
  customer: Customer;
  items: OrderItem[];
};

export type StuartDispatchResult = {
  jobId?: string;
  deliveryId?: string;
  estimatedDropoffAt?: Date;
  estimatedPickupAt?: Date;
  trackingUrl?: string;
  clientTrackingUrl?: string;
  status?: string;
  raw: unknown;
  requestPayload: StuartCreateJobPayload;
};

@Injectable()
export class StuartFulfilmentService {
  private readonly logger = new Logger(StuartFulfilmentService.name);
  private accessToken?: string;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {}

  isConfigured() {
    return Boolean(
      this.configService.get<string>("STUART_CLIENT_ID") &&
        this.configService.get<string>("STUART_CLIENT_SECRET") &&
        this.configService.get<string>("STUART_PICKUP_ADDRESS") &&
        this.configService.get<string>("STUART_PICKUP_PHONE"),
    );
  }

  async createDelivery(order: StuartDispatchOrder): Promise<StuartDispatchResult> {
    const requestPayload = this.buildCreateJobPayload(order);
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${this.apiBaseUrl}/v2/jobs`, {
      body: JSON.stringify(requestPayload),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const responseBody = await this.parseResponseBody(response);

    if (!response.ok) {
      this.logger.error(
        `Stuart delivery creation failed for ${order.orderNumber}: ${JSON.stringify(
          responseBody,
        )}`,
      );
      throw new Error(this.getStuartErrorMessage(responseBody));
    }

    return {
      ...this.extractJobResult(responseBody),
      raw: responseBody,
      requestPayload,
    };
  }

  private buildCreateJobPayload(order: StuartDispatchOrder) {
    const deliveryAddress = this.asAddress(order.deliveryAddress);
    const pickupAt = this.getPickupAt(order);

    return {
      job: {
        ...(pickupAt ? { pickup_at: pickupAt } : {}),
        pickups: [
          {
            address: this.configService.getOrThrow<string>(
              "STUART_PICKUP_ADDRESS",
            ),
            comment: this.configService.get<string>(
              "STUART_PICKUP_COMMENT",
              "FoodMenu order pickup",
            ),
            contact: {
              company: this.configService.get<string>(
                "STUART_PICKUP_COMPANY",
                "FoodMenu",
              ),
              email: this.configService.get<string>("STUART_PICKUP_EMAIL"),
              firstname: this.configService.get<string>(
                "STUART_PICKUP_FIRST_NAME",
                "Okechukwu",
              ),
              lastname: this.configService.get<string>(
                "STUART_PICKUP_LAST_NAME",
                "Eze",
              ),
              phone: this.configService.getOrThrow<string>(
                "STUART_PICKUP_PHONE",
              ),
            },
          },
        ],
        dropoffs: [
          {
            address: this.formatAddress(deliveryAddress),
            client_reference: order.orderNumber,
            comment: this.stringValue(
              this.asRecord(order.deliveryAddress).instructions ??
                this.asRecord(order.deliveryAddress).comment,
            ),
            contact: {
              email: order.customer.email,
              firstname: order.customer.firstName ?? "FoodMenu",
              lastname: order.customer.lastName ?? "Customer",
              phone:
                order.customer.phone ??
                this.configService.get<string>("STUART_FALLBACK_CUSTOMER_PHONE"),
            },
            package_description: this.packageDescription(order.items),
            package_type: this.configService.get<string>(
              "STUART_PACKAGE_TYPE",
              "medium",
            ),
          },
        ],
      },
    };
  }

  private async getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: this.configService.getOrThrow<string>("STUART_CLIENT_ID"),
      client_secret: this.configService.getOrThrow<string>(
        "STUART_CLIENT_SECRET",
      ),
      grant_type: "client_credentials",
      scope: "api",
    });
    const response = await fetch(`${this.apiBaseUrl}/oauth/token`, {
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
    const responseBody = (await this.parseResponseBody(
      response,
    )) as Partial<StuartTokenResponse>;

    if (!response.ok || !responseBody.access_token) {
      throw new Error(this.getStuartErrorMessage(responseBody));
    }

    this.accessToken = responseBody.access_token;
    this.tokenExpiresAt =
      Date.now() + Math.max((responseBody.expires_in ?? 3600) - 60, 60) * 1000;

    return this.accessToken;
  }

  private get apiBaseUrl() {
    return this.configService.get<string>(
      "STUART_API_BASE_URL",
      "https://api.sandbox.stuart.com",
    );
  }

  private getPickupAt(order: Order) {
    const metadata = this.asRecord(order.metadata);
    const pickupAt = this.stringValue(metadata.pickupAt);
    if (pickupAt) return pickupAt;

    const delayMinutes = this.configService.get<number>(
      "STUART_PICKUP_DELAY_MINUTES",
      15,
    );
    return new Date(Date.now() + delayMinutes * 60_000).toISOString();
  }

  private asAddress(value: unknown): StuartAddress {
    const address = this.asRecord(value);
    return {
      city: this.stringValue(address.city),
      country: this.stringValue(address.country),
      line1: this.stringValue(address.line1 ?? address.addressLine1),
      line2: this.stringValue(address.line2 ?? address.addressLine2),
      postcode: this.stringValue(address.postcode ?? address.postalCode),
      raw: this.stringValue(address.raw ?? address.formattedAddress),
    };
  }

  private formatAddress(address: StuartAddress) {
    if (address.raw) return address.raw;

    const formattedAddress = [
      address.line1,
      address.line2,
      address.city,
      address.postcode,
      address.country,
    ]
      .filter(Boolean)
      .join(", ");

    if (!formattedAddress) {
      throw new Error("Delivery address is required before dispatching Stuart.");
    }

    return formattedAddress;
  }

  private packageDescription(items: OrderItem[]) {
    const description = items
      .map((item) => `${item.quantity}x ${item.name}`)
      .join(", ");

    return description || "FoodMenu order";
  }

  private extractJobResult(responseBody: unknown) {
    const response = this.asRecord(responseBody);
    const deliveries = Array.isArray(response.deliveries)
      ? response.deliveries
      : [];
    const delivery = this.asRecord(deliveries[0]);

    return {
      clientTrackingUrl: this.stringValue(
        delivery.client_tracking_url ?? delivery.tracking_url,
      ),
      deliveryId: this.stringValue(delivery.id),
      estimatedDropoffAt: this.dateValue(
        delivery.eta_to_destination ??
          delivery.etaToDestination ??
          delivery.estimated_dropoff_at ??
          delivery.estimatedDropoffAt,
      ),
      estimatedPickupAt: this.dateValue(
        delivery.eta_to_origin ??
          delivery.etaToOrigin ??
          delivery.estimated_pickup_at ??
          delivery.estimatedPickupAt,
      ),
      jobId: this.stringValue(response.id),
      status: this.stringValue(delivery.status ?? response.status),
      trackingUrl: this.stringValue(delivery.tracking_url),
    };
  }

  private async parseResponseBody(response: Response) {
    const text = await response.text();
    if (!text) return {};

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }

  private getStuartErrorMessage(responseBody: unknown) {
    const response = this.asRecord(responseBody);
    const errors = Array.isArray(response.errors) ? response.errors : [];
    const firstError = this.asRecord(errors[0]);

    return (
      this.stringValue(response.message) ??
      this.stringValue(response.error) ??
      this.stringValue(firstError.message) ??
      "Stuart request failed"
    );
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  }

  private stringValue(value: unknown) {
    if (value === null || value === undefined || value === "") return undefined;
    return String(value);
  }

  private dateValue(value: unknown) {
    const stringValue = this.stringValue(value);
    if (!stringValue) return undefined;

    const date = new Date(stringValue);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
}
