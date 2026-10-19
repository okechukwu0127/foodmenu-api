import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { decode } from "@googlemaps/polyline-codec";

export type LatLng = {
  latitude: number;
  longitude: number;
};

@Injectable()
export class GoogleRoutesService {
  private readonly logger = new Logger(GoogleRoutesService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured() {
    return Boolean(this.configService.get<string>("GOOGLE_ROUTES_API_KEY"));
  }

  async getRouteCoordinates(params: {
    origin: LatLng;
    destination: LatLng;
  }) {
    const apiKey = this.configService.get<string>("GOOGLE_ROUTES_API_KEY");
    if (!apiKey) return [];

    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        body: JSON.stringify({
          destination: {
            location: {
              latLng: {
                latitude: params.destination.latitude,
                longitude: params.destination.longitude,
              },
            },
          },
          origin: {
            location: {
              latLng: {
                latitude: params.origin.latitude,
                longitude: params.origin.longitude,
              },
            },
          },
          polylineQuality: "HIGH_QUALITY",
          routingPreference: "TRAFFIC_AWARE",
          travelMode: "DRIVE",
        }),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.polyline.encodedPolyline",
        },
        method: "POST",
      },
    );

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn(`Google Routes API failed: ${body}`);
      return [];
    }

    const data = (await response.json()) as {
      routes?: Array<{
        polyline?: {
          encodedPolyline?: string;
        };
      }>;
    };
    const encodedPolyline = data.routes?.[0]?.polyline?.encodedPolyline;
    if (!encodedPolyline) return [];

    return decode(encodedPolyline).map(([latitude, longitude]) => ({
      latitude,
      longitude,
    }));
  }
}
