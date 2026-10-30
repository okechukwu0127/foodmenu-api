import { boldFoodNames } from "./bold-food-names";

it("bolds complete food names without nesting existing Markdown or changing partial words", () => {
  expect(
    boldFoodNames("Try Suya, **Suya**, Jollof Rice and meals. `Suya`", [
      "Suya",
      "Jollof Rice",
      "Meal",
    ]),
  ).toBe("Try **Suya**, **Suya**, **Jollof Rice** and meals. `Suya`");
});
it("escapes punctuation in menu names and matches the longest name first", () => {
  expect(
    boldFoodNames("Suya (Hot) + Rice is available; Suya too.", [
      "Suya",
      "Suya (Hot) + Rice",
    ]),
  ).toBe("**Suya (Hot) + Rice** is available; **Suya** too.");
});
