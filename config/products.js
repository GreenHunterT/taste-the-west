// ─────────────────────────────────────────────────────────────────
//  TASTE THE WEST — Menu (static fallback)
//  Used when Supabase is not configured or for offline testing.
//
//  Images: all set to "" so the product-placeholder.svg shows,
//  clearly indicating where the owner's real product photos go.
//  Upload actual photos via Admin → Menu → Edit → Upload Image.
// ─────────────────────────────────────────────────────────────────
const PRODUCTS = [

  // ── PIZZA ─────────────────────────────────────────────────────
  {
    id:            1,
    name:          "مارغريتا كلاسيك",
    nameEn:        "Classic Margherita",
    price:         "39 SAR",
    category:      "pizza",
    image:         "",
    description:   "صلصة طماطم طازجة، جبن موزاريلا كريمي، وريحان.",
    descriptionEn: "Fresh tomato sauce, creamy mozzarella, and fresh basil.",
    featured:      true
  },
  {
    id:            2,
    name:          "ببروني دبل",
    nameEn:        "Double Pepperoni",
    price:         "49 SAR",
    category:      "pizza",
    image:         "",
    description:   "طبقتان من الببروني المحمر فوق قاعدة طماطم غنية.",
    descriptionEn: "Double layer of crispy pepperoni on a rich tomato base.",
    featured:      true
  },
  {
    id:            3,
    name:          "دجاج غربي",
    nameEn:        "Western BBQ Chicken",
    price:         "52 SAR",
    category:      "pizza",
    image:         "",
    description:   "دجاج مشوي مع صوص بي بي كيو وبصل كاراميل.",
    descriptionEn: "Grilled chicken, smoky BBQ sauce, and caramelised onion.",
    featured:      true
  },
  {
    id:            4,
    name:          "سبيشال تيست",
    nameEn:        "TTW Special",
    price:         "59 SAR",
    category:      "pizza",
    image:         "",
    description:   "توليفتنا الخاصة من المكونات المميزة — بيتزا التوقيع.",
    descriptionEn: "Our signature blend of premium toppings — the house special.",
    featured:      false
  },
  {
    id:            5,
    name:          "فور تشيز",
    nameEn:        "Four Cheese",
    price:         "55 SAR",
    category:      "pizza",
    image:         "",
    description:   "أربعة أنواع من الجبن المذاب على قاعدة كريمية.",
    descriptionEn: "Four melted cheeses on a rich creamy base.",
    featured:      false
  },

  // ── SIDES ─────────────────────────────────────────────────────
  {
    id:            6,
    name:          "بطاطس مقرمشة",
    nameEn:        "Crispy Fries",
    price:         "19 SAR",
    category:      "sides",
    image:         "",
    description:   "بطاطس ذهبية مقرمشة مع صوص الدار.",
    descriptionEn: "Golden crispy fries served with our house dipping sauce.",
    featured:      false
  },
  {
    id:            7,
    name:          "أجنحة الدجاج",
    nameEn:        "Chicken Wings",
    price:         "35 SAR",
    category:      "sides",
    image:         "",
    description:   "أجنحة دجاج متبلة بنكهة غربية مميزة.",
    descriptionEn: "Seasoned chicken wings with a western-style glaze.",
    featured:      false
  },
  {
    id:            8,
    name:          "خبز الثوم",
    nameEn:        "Garlic Bread",
    price:         "15 SAR",
    category:      "sides",
    image:         "",
    description:   "خبز مقرمش بالثوم والزبدة، مخبوز طازج.",
    descriptionEn: "Crispy garlic butter bread, baked fresh.",
    featured:      false
  },

  // ── DRINKS ────────────────────────────────────────────────────
  {
    id:            9,
    name:          "ليمون طازج",
    nameEn:        "Fresh Lemonade",
    price:         "12 SAR",
    category:      "drinks",
    image:         "",
    description:   "عصير ليمون طازج محضّر يومياً.",
    descriptionEn: "Freshly squeezed lemonade, made daily.",
    featured:      false
  },
  {
    id:            10,
    name:          "مشروب غازي",
    nameEn:        "Soft Drink",
    price:         "8 SAR",
    category:      "drinks",
    image:         "",
    description:   "مشروب غازي بارد — اختر نكهتك.",
    descriptionEn: "Ice-cold soft drink — choose your flavour.",
    featured:      false
  },
  {
    id:            11,
    name:          "ماء معدني",
    nameEn:        "Mineral Water",
    price:         "5 SAR",
    category:      "drinks",
    image:         "",
    description:   "ماء معدني بارد.",
    descriptionEn: "Chilled mineral water.",
    featured:      false
  }
];
