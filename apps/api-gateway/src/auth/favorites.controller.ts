import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import {
  CustomerFavoriteResponseDto,
  CustomerFavoritesResponseDto,
  FavoriteFoodIdParamDto,
} from "@app/dto";
import { AuthGuard, CurrentLogin, Login } from "./auth.guard";
import { IdentityClientService } from "./identity-client.service";

@ApiTags("Customer favorites")
@ApiBearerAuth()
@ApiBadRequestResponse({ description: "Invalid food ID" })
@ApiUnauthorizedResponse({
  description: "Missing, invalid or expired bearer session token",
})
@UseGuards(AuthGuard)
@Controller("me/favorites")
export class FavoritesController {
  constructor(private readonly identity: IdentityClientService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "List the signed-in customer's favorite food IDs" })
  @ApiOkResponse({ type: CustomerFavoritesResponseDto })
  list(@CurrentLogin() login: Login) {
    return this.identity.listFavorites(login.customerId);
  }

  @Put(":foodId")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Add a food ID to favorites; repeating the request is safe",
  })
  @ApiOkResponse({ type: CustomerFavoriteResponseDto })
  put(@CurrentLogin() login: Login, @Param() params: FavoriteFoodIdParamDto) {
    return this.identity.putFavorite(login.customerId, params.foodId);
  }

  @Delete(":foodId")
  @HttpCode(204)
  @ApiOperation({
    summary: "Remove a food ID from favorites; absent IDs are ignored",
  })
  @ApiNoContentResponse({ description: "Removed or already absent" })
  async delete(
    @CurrentLogin() login: Login,
    @Param() params: FavoriteFoodIdParamDto,
  ) {
    await this.identity.deleteFavorite(login.customerId, params.foodId);
  }
}
