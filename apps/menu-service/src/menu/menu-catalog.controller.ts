import { CartPricingService } from "../pricing/cart-pricing.service";
import { commerceRpc } from "@app/dto";
import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { MENU_PATTERNS } from "@app/common";
import { FoodListQueryDto } from "@app/dto";
import { MenuCatalogService } from "./menu-catalog.service";

@Controller()
export class MenuCatalogController {
  constructor(
    private readonly menuCatalogService: MenuCatalogService,
    private readonly pricing: CartPricingService,
  ) {}

  @MessagePattern(MENU_PATTERNS.PRICE_CART)
  priceCart(@Payload() payload: unknown) {
    return commerceRpc(() => this.pricing.price(payload));
  }

  @MessagePattern(MENU_PATTERNS.GET_BOOTSTRAP)
  getBootstrap() {
    return this.menuCatalogService.getBootstrap();
  }

  @MessagePattern(MENU_PATTERNS.GET_CATEGORIES)
  getCategories() {
    return this.menuCatalogService.getCategories();
  }

  @MessagePattern(MENU_PATTERNS.GET_FOODS)
  getFoods(@Payload() query: FoodListQueryDto) {
    return this.menuCatalogService.getFoods(query);
  }

  @MessagePattern(MENU_PATTERNS.GET_FOOD_BY_ID)
  getFoodById(@Payload() foodId: string) {
    return this.menuCatalogService.getFoodById(foodId);
  }

  @MessagePattern(MENU_PATTERNS.GET_DEALS)
  getDeals() {
    return this.menuCatalogService.getDeals();
  }

  @MessagePattern(MENU_PATTERNS.GET_HERO_SLIDES)
  getHeroSlides() {
    return this.menuCatalogService.getHeroSlides();
  }

  @MessagePattern(MENU_PATTERNS.GET_HOT_COMBOS)
  getHotCombos() {
    return this.menuCatalogService.getHotCombos();
  }

  @MessagePattern(MENU_PATTERNS.GET_DRINK_ADD_ONS)
  getDrinkAddOns() {
    return this.menuCatalogService.getDrinkAddOns();
  }

  @MessagePattern(MENU_PATTERNS.GET_MODIFIER_GROUPS)
  getModifierGroups() {
    return this.menuCatalogService.getModifierGroups();
  }

  @MessagePattern(MENU_PATTERNS.GET_MODIFIER_LABEL_TRANSLATIONS)
  getModifierLabelTranslations() {
    return this.menuCatalogService.getModifierLabelTranslations();
  }
}
