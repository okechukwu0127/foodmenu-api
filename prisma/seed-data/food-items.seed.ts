export const foodItemsSeed = [
  {
    calories: 650,
    categoryId: "burgers",
    description: "A juicy beef burger with cheddar, lettuce, and house sauce.",
    id: "classic-cheeseburger",
    images: [
      {
        altText: "Classic cheeseburger",
        url: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600",
      },
    ],
    isPopular: true,
    modifierGroupIds: ["burger-size", "burger-extras"],
    name: "Classic Cheeseburger",
    prepTimeMinutes: 18,
    price: 1299,
    rating: 4.7,
    slug: "classic-cheeseburger",
    sortOrder: 1,
  },
  {
    calories: 720,
    categoryId: "burgers",
    description: "Double beef patties, melted cheese, pickles, and onions.",
    id: "double-stack-burger",
    images: [
      {
        altText: "Double stack burger",
        url: "https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=600",
      },
    ],
    isPopular: true,
    modifierGroupIds: ["burger-size", "burger-extras"],
    name: "Double Stack Burger",
    prepTimeMinutes: 20,
    price: 1599,
    rating: 4.8,
    slug: "double-stack-burger",
    sortOrder: 2,
  },
];
