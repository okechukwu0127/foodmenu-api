import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Query,
} from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { catchError, firstValueFrom, throwError } from "rxjs";
import { MENU_PATTERNS } from "@app/common";
import {
  CategoryResponseDto,
  DealResponseDto,
  DrinkAddOnResponseDto,
  FoodDetailsResponseDto,
  FoodIdParamDto,
  FoodListQueryDto,
  FoodListResponseDto,
  HeroSlideResponseDto,
  HotComboResponseDto,
  MenuBootstrapResponseDto,
  ModifierGroupResponseDto,
} from "@app/dto";
import { AppError } from "@app/errors";

@ApiTags("Menu Catalog")
@Controller("menu")
export class MenuController {
  constructor(
    @Inject("MENU_SERVICE")
    private readonly menuClient: ClientProxy,
  ) {}

  @Get("bootstrap")
  @Header("Cache-Control", "public, max-age=60")
  @ApiOperation({ summary: "Load the full mobile menu bootstrap payload" })
  @ApiResponse({ status: 200, type: MenuBootstrapResponseDto })
  getBootstrap() {
    return this.send(MENU_PATTERNS.GET_BOOTSTRAP, {});
  }

  @Get("categories")
  @Header("Cache-Control", "public, max-age=300")
  @ApiOperation({ summary: "List active menu categories" })
  @ApiResponse({ status: 200, type: [CategoryResponseDto] })
  getCategories() {
    return this.send(MENU_PATTERNS.GET_CATEGORIES, {});
  }

  @Get("foods")
  @Header("Cache-Control", "public, max-age=60")
  @ApiOperation({ summary: "List menu foods with filtering and pagination" })
  @ApiQuery({ name: "categoryId", required: false })
  @ApiQuery({ name: "search", required: false })
  @ApiQuery({ name: "isPopular", required: false, type: Boolean })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiResponse({ status: 200, type: FoodListResponseDto })
  getFoods(@Query() query: FoodListQueryDto) {
    return this.send(MENU_PATTERNS.GET_FOODS, query);
  }

  @Get("foods/:foodId")
  @Header("Cache-Control", "public, max-age=60")
  @ApiOperation({ summary: "Get food details by id or slug" })
  @ApiParam({ name: "foodId", example: "classic-cheeseburger" })
  @ApiResponse({ status: 200, type: FoodDetailsResponseDto })
  getFoodById(@Param() params: FoodIdParamDto) {
    return this.send(MENU_PATTERNS.GET_FOOD_BY_ID, params.foodId);
  }

  @Get("deals")
  @Header("Cache-Control", "public, max-age=120")
  @ApiOperation({ summary: "List active menu deals" })
  @ApiResponse({ status: 200, type: [DealResponseDto] })
  getDeals() {
    return this.send(MENU_PATTERNS.GET_DEALS, {});
  }

  @Get("hero-slides")
  @Header("Cache-Control", "public, max-age=120")
  @ApiOperation({ summary: "List active hero slides" })
  @ApiResponse({ status: 200, type: [HeroSlideResponseDto] })
  getHeroSlides() {
    return this.send(MENU_PATTERNS.GET_HERO_SLIDES, {});
  }

  @Get("hot-combos")
  @Header("Cache-Control", "public, max-age=120")
  @ApiOperation({ summary: "List active hot combos with linked food details" })
  @ApiResponse({ status: 200, type: [HotComboResponseDto] })
  getHotCombos() {
    return this.send(MENU_PATTERNS.GET_HOT_COMBOS, {});
  }

  @Get("drink-add-ons")
  @Header("Cache-Control", "public, max-age=300")
  @ApiOperation({ summary: "List active drink add-ons" })
  @ApiResponse({ status: 200, type: [DrinkAddOnResponseDto] })
  getDrinkAddOns() {
    return this.send(MENU_PATTERNS.GET_DRINK_ADD_ONS, {});
  }

  @Get("modifier-groups")
  @Header("Cache-Control", "public, max-age=300")
  @ApiOperation({ summary: "List active modifier groups and options" })
  @ApiResponse({ status: 200, type: [ModifierGroupResponseDto] })
  getModifierGroups() {
    return this.send(MENU_PATTERNS.GET_MODIFIER_GROUPS, {});
  }

  @Get("modifier-label-translations")
  @Header("Cache-Control", "public, max-age=300")
  @ApiOperation({ summary: "List modifier label translations" })
  @ApiResponse({ status: 200, schema: { type: "array" } })
  getModifierLabelTranslations() {
    return this.send(MENU_PATTERNS.GET_MODIFIER_LABEL_TRANSLATIONS, {});
  }

  private send<TPayload>(pattern: string, payload: TPayload) {
    return firstValueFrom(
      this.menuClient.send(pattern, payload).pipe(
        catchError((error: { code?: string; message?: string }) =>
          throwError(
            () =>
              new AppError(
                error.code ?? "MENU_SERVICE_ERROR",
                error.message ?? "Menu service request failed",
                502,
                error,
              ),
          ),
        ),
      ),
    );
  }
}
