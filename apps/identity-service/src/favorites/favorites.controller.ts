import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { IDENTITY_PATTERNS } from "@app/common";
import { CustomerFavoriteKeyPayload, CustomerFavoritesPayload } from "@app/dto";
import { FavoritesService } from "./favorites.service";

@Controller()
export class IdentityFavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @MessagePattern(IDENTITY_PATTERNS.LIST_FAVORITES)
  list(@Payload() dto: CustomerFavoritesPayload) {
    return this.favorites.list(dto.customerId);
  }

  @MessagePattern(IDENTITY_PATTERNS.PUT_FAVORITE)
  put(@Payload() dto: CustomerFavoriteKeyPayload) {
    return this.favorites.put(dto.customerId, dto.foodId);
  }

  @MessagePattern(IDENTITY_PATTERNS.DELETE_FAVORITE)
  delete(@Payload() dto: CustomerFavoriteKeyPayload) {
    return this.favorites.delete(dto.customerId, dto.foodId);
  }
}
