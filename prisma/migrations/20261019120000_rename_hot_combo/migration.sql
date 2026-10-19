-- Preserve existing combo records and food item links.
ALTER TABLE "HotBurgerCombo" RENAME TO "HotCombo";
ALTER TABLE "HotCombo" RENAME CONSTRAINT "HotBurgerCombo_pkey" TO "HotCombo_pkey";
ALTER TABLE "HotCombo" RENAME CONSTRAINT "HotBurgerCombo_foodItemId_fkey" TO "HotCombo_foodItemId_fkey";
ALTER INDEX "HotBurgerCombo_isActive_idx" RENAME TO "HotCombo_isActive_idx";
ALTER INDEX "HotBurgerCombo_sortOrder_idx" RENAME TO "HotCombo_sortOrder_idx";
ALTER INDEX "HotBurgerCombo_foodItemId_idx" RENAME TO "HotCombo_foodItemId_idx";
