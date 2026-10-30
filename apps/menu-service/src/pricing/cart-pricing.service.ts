import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  CartLine,
  cartLineSchema,
  commerceFailure as fail,
  commerceParse as parse,
  PricedLine,
} from "@app/dto";
import { MenuCatalogService } from "../menu/menu-catalog.service";
@Injectable()
export class CartPricingService {
  constructor(private readonly menu: MenuCatalogService) {}
  async price(input: unknown) {
    const dto = parse(
      z
        .object({
          items: z.array(cartLineSchema).min(1).max(30),
          draft: z.boolean().optional(),
        })
        .strict(),
      input,
    );
    if (new Set(dto.items.map((i) => i.lineId)).size !== dto.items.length)
      fail("CART_DUPLICATE_LINE", "Duplicate line IDs");
    const items: PricedLine[] = [];
    for (const line of dto.items) items.push(await this.line(line, !dto.draft));
    const currency = items[0].currency;
    if (items.some((i) => i.currency !== currency))
      fail("CART_CURRENCY_MISMATCH", "A cart must use one currency");
    return {
      items,
      currency,
      subtotal: items.reduce((n, i) => n + i.lineAmount, 0),
    };
  }
  private async line(line: CartLine, complete: boolean): Promise<PricedLine> {
    const food = await this.menu.getFoodById(line.foodId);
    if (!food.isFoodAvailable)
      fail("FOOD_UNAVAILABLE", "Selected food is unavailable", 409);
    let unitAmount = Math.round(food.price * 100);
    const keys = line.modifiers.map((m) => `${m.groupId}:${m.optionId}`);
    if (new Set(keys).size !== keys.length)
      fail("INVALID_MODIFIER", "Duplicate modifier selections");
    for (const m of line.modifiers) {
      const group = food.modifierGroups.find((g) => g.id === m.groupId);
      const option = group?.options.find((o) => o.id === m.optionId);
      if (
        !group ||
        !option ||
        m.quantity > (option.maxQuantity ?? 1) ||
        (group.quantityMode === "none" && m.quantity !== 1)
      )
        fail("INVALID_MODIFIER", "Modifier is not permitted for this food");
      unitAmount += Math.round(option.priceOffset * 100) * m.quantity;
    }
    for (const group of food.modifierGroups) {
      const selected = line.modifiers.filter((m) => m.groupId === group.id);
      if (
        (complete &&
          selected.length <
            Math.max(group.minSelections, group.isRequired ? 1 : 0)) ||
        selected.length > (group.maxSelections ?? group.options.length) ||
        (group.selectionType === "SINGLE" && selected.length > 1)
      )
        fail(
          "MODIFIER_SELECTION_REQUIRED",
          "Selections violate a modifier group's rules",
        );
    }
    const sizes = Array.isArray(food.sizeOptions)
      ? (food.sizeOptions as any[])
      : [];
    if (line.sizeId) {
      if (food.modifierGroups.some((g) => /size/i.test(g.slug)))
        fail(
          "AMBIGUOUS_SIZE",
          "Use the size modifier group instead of a second size selection",
        );
      const size = sizes.find((s) => s.id === line.sizeId);
      if (
        !size ||
        typeof size.priceOffset !== "number" ||
        !Number.isFinite(size.priceOffset)
      )
        fail("INVALID_SIZE", "Size is not permitted");
      unitAmount += Math.round(size.priceOffset * 100);
    }
    const extraKeys = line.extras.map((e) => `${e.kind}:${e.optionId}`);
    if (new Set(extraKeys).size !== extraKeys.length)
      fail("INVALID_EXTRA", "Duplicate extras");
    for (const extra of line.extras) {
      const source =
        extra.kind === "side" ? food.sideOptions : food.appetizerOptions;
      const option = Array.isArray(source)
        ? (source as any[]).find((o) => o.id === extra.optionId)
        : null;
      if (
        !option ||
        typeof option.price !== "number" ||
        !Number.isFinite(option.price) ||
        option.price < 0
      )
        fail("INVALID_EXTRA", "Extra is not permitted for this food");
      unitAmount += Math.round(option.price * 100) * extra.quantity;
    }
    if (
      !Number.isSafeInteger(unitAmount) ||
      unitAmount < 0 ||
      unitAmount * line.quantity > 100000000
    )
      fail("INVALID_PRICE", "Food pricing is invalid");
    const name =
      typeof food.name === "string"
        ? food.name
        : ((food.name as Record<string, string>)?.en ?? food.id);
    return {
      ...line,
      foodId: food.id,
      name,
      currency: food.currency.toUpperCase(),
      unitAmount,
      lineAmount: unitAmount * line.quantity,
      food,
    };
  }
}
