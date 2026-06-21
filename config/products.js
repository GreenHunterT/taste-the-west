// ─────────────────────────────────────────────────────────────────
//  TASTE THE WEST — Menu
//  Categories: pizza · sides · drinks
//
//  Demo images: loremflickr.com (actual food photos, no hotlink blocking).
//  Replace each URL with a local file once the owner provides photos:
//    image: "assets/images/products/margherita.jpg"
//  Recommended size: 600 × 450 px, compressed under 200 KB.
// ─────────────────────────────────────────────────────────────────
const PRODUCTS = [

  // ── PIZZA ─────────────────────────────────────────────────────
  {
    id:            1,
    name:          "مارغريتا كلاسيك",
    nameEn:        "Classic Margherita",
    price:         "39 SAR",
    category:      "pizza",
    image:         "https://loremflickr.com/600/450/margherita,pizza?lock=201",
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
    image:         "https://loremflickr.com/600/450/pepperoni,pizza?lock=202",
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
    image:         "https://loremflickr.com/600/450/chicken,pizza?lock=203",
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
    image:         "https://loremflickr.com/600/450/gourmet,pizza?lock=204",
    description:   "توليفتنا الخاصة من المكونات المميزة — بيتزا التوقيع.",
    descriptionEn: "Our signature blend of premium toppings — the house special.",
    featured:      false
  },

  // ── SIDES ─────────────────────────────────────────────────────
  {
    id:            5,
    name:          "بطاطس مقرمشة",
    nameEn:        "Crispy Fries",
    price:         "19 SAR",
    category:      "sides",
    image:         "https://loremflickr.com/600/450/french,fries?lock=205",
    description:   "بطاطس ذهبية مقرمشة مع صوص الدار.",
    descriptionEn: "Golden crispy fries served with our house dipping sauce.",
    featured:      false
  },
  {
    id:            6,
    name:          "أجنحة الدجاج",
    nameEn:        "Chicken Wings",
    price:         "35 SAR",
    category:      "sides",
    image:         "https://loremflickr.com/600/450/chicken,wings?lock=206",
    description:   "أجنحة دجاج متبلة بنكهة غربية مميزة.",
    descriptionEn: "Seasoned chicken wings with a western-style glaze.",
    featured:      false
  },

  // ── DRINKS ────────────────────────────────────────────────────
  {
    id:            7,
    name:          "ليمون طازج",
    nameEn:        "Fresh Lemonade",
    price:         "12 SAR",
    category:      "drinks",
    image:         "https://loremflickr.com/600/450/lemonade,drink?lock=207",
    description:   "عصير ليمون طازج محضّر يومياً.",
    descriptionEn: "Freshly squeezed lemonade, made daily.",
    featured:      false
  },
  {
    id:            8,
    name:          "مشروب غازي",
    nameEn:        "Soft Drink",
    price:         "8 SAR",
    category:      "drinks",
    image:         "https://loremflickr.com/600/450/cola,soda?lock=208",
    description:   "مشروب غازي بارد — اختر نكهتك.",
    descriptionEn: "Ice-cold soft drink — choose your flavour.",
    featured:      false
  }
];
