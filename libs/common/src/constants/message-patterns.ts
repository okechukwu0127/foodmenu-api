export const PAYMENT_PATTERNS = {
  CONFIRM_PAYMENT: "payment.confirm",
  CREATE_PAYMENT_INTENT: "payment.createIntent",
  GET_PAYMENT_STATUS: "payment.getStatus",
  HANDLE_STRIPE_WEBHOOK: "payment.handleStripeWebhook",
  REFUND_PAYMENT: "payment.refund",
} as const;

export const MENU_PATTERNS = {
  GET_BOOTSTRAP: "menu.getBootstrap",
  GET_CATEGORIES: "menu.getCategories",
  GET_DEALS: "menu.getDeals",
  GET_DRINK_ADD_ONS: "menu.getDrinkAddOns",
  GET_FOOD_BY_ID: "menu.getFoodById",
  GET_FOODS: "menu.getFoods",
  GET_HERO_SLIDES: "menu.getHeroSlides",
  GET_HOT_COMBOS: "menu.getHotCombos",
  GET_MODIFIER_GROUPS: "menu.getModifierGroups",
  GET_MODIFIER_LABEL_TRANSLATIONS: "menu.getModifierLabelTranslations",
} as const;
