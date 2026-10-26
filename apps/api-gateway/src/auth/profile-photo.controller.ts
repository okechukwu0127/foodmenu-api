import {
  BadRequestException,
  Controller,
  Header,
  HttpCode,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ThrottlerGuard } from "@nestjs/throttler";
import { memoryStorage } from "multer";
import { PROFILE_PHOTO_MAX_BYTES } from "@app/dto";
import { AuthGuard, CurrentLogin, Login } from "./auth.guard";
import { IdentityClientService } from "./identity-client.service";

@ApiTags("Profile photos")
@ApiBearerAuth()
@UseGuards(ThrottlerGuard, AuthGuard)
@Controller("auth/me/photo")
export class ProfilePhotoController {
  constructor(private readonly identity: IdentityClientService) {}

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @UseInterceptors(
    FileInterceptor("photo", {
      storage: memoryStorage(),
      limits: { fileSize: PROFILE_PHOTO_MAX_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["photo"],
      properties: {
        photo: {
          type: "string",
          format: "binary",
          description: "JPEG, PNG or WebP, maximum 5 MB",
        },
      },
    },
  })
  @ApiOperation({
    summary: "Upload a profile photo and return the updated user with photoUrl",
  })
  @ApiResponse({
    status: 200,
    description: "Updated profile in the standard success/data envelope",
  })
  @ApiResponse({
    status: 400,
    description: "Missing, invalid, animated or unsupported image",
  })
  @ApiResponse({
    status: 401,
    description: "Missing, invalid or expired login token",
  })
  @ApiResponse({ status: 413, description: "Photo exceeds 5 MB" })
  upload(
    @CurrentLogin() login: Login,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    if (!photo)
      throw new BadRequestException("Attach an image using the photo field");
    return this.identity.uploadProfilePhoto(
      login.accountId,
      photo.buffer.toString("base64"),
      photo.mimetype,
    );
  }
}
