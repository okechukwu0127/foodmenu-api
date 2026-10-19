import { DefaultModifierScope } from "@prisma/client";

export const defaultModifierGroupsSeed = [
  {
    id: "global-burger-size",
    modifierGroupId: "burger-size",
    scope: DefaultModifierScope.GLOBAL,
    sortOrder: 1,
  },
];
