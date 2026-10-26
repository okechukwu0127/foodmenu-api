import * as express from "express";
import { ConfigService } from "@nestjs/config";
import { resolve } from "path";
import { INestApplication } from "@nestjs/common";

export function mountProfilePhotoAssets(
  app: INestApplication,
  config: ConfigService,
) {
  app.use(
    "/uploads/profile-photos",
    express.static(
      resolve(
        config.get<string>(
          "PROFILE_PHOTO_STORAGE_DIR",
          "uploads/profile-photos",
        ),
      ),
      {
        dotfiles: "deny",
        index: false,
        redirect: false,
        immutable: true,
        maxAge: "7d",
        setHeaders: (response) => {
          response.setHeader("X-Content-Type-Options", "nosniff");
        },
      },
    ),
  );
}
