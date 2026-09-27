// =================================================================
//  Admin Interface i18n  (milestone 1T)
//
//  The ONE localization layer for the Admin's OWN interface (headings,
//  labels, buttons, hints, toasts, dialogs). It never touches business
//  content: bilingual data fields (Name (English) + Name (Arabic), …) always
//  stay visible — only their Admin labels are translated. It is also fully
//  independent of the Live Preview language (live-preview.js owns that; its
//  state persists as `ttw_admin_ui.lang`, this one as `ttw_admin_ui.adminLang`).
//
//  Layout stays structurally LTR in both languages: the document is NEVER set
//  to dir="rtl". Instead each translated text node's own element receives
//  dir="rtl" lang="ar" in Arabic mode, so Arabic text reads/aligns naturally
//  while the dashboard geometry (settings left, Live Preview right) is fixed.
//
//  Markup contract (static HTML and view templates):
//    data-i18n="key"             → element text (first non-empty text node if
//                                  the element also has child elements, so a
//                                  label's <span class="required"> survives)
//    data-i18n-placeholder / -title / -aria-label / -alt = "key" → attribute
//    data-i18n-vars='{"n":2}'    → interpolation for {n}; a var may be
//                                  {"key":"other.key"} to nest a translation
//    data-i18n-dir               → direction-only container (no text of its
//                                  own) for mixed children, e.g. upload label
//
//  API (window.AdminI18n): t, getLang, setLang, apply, set, setAttr, onChange.
//  Loaded BEFORE auth.js and every view, so all of them can call it.
// =================================================================

window.AdminI18n = (function () {
  'use strict';

  var UI_KEY = 'ttw_admin_ui';      // shared UI-only prefs blob (see admin-shell.js)
  var LANGS = ['en', 'ar'];
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  // ── Dictionaries ────────────────────────────────────────────────
  // Stable dotted keys; EN and AR must have identical key sets (tested).
  var EN = {
    // Shell / app bar
    'shell.docTitle': 'Admin — Taste The West',
    'shell.navAria': 'Admin sections',
    'shell.nav.menu': 'Menu',
    'shell.nav.settings': 'Settings',
    'shell.viewSite': 'View Site',
    'shell.signOut': 'Sign Out',
    'shell.soundOn': 'Admin sounds on',
    'shell.soundOff': 'Admin sounds off',
    'shell.loadBanner': 'Restaurant settings could not be loaded. Reload the page before making changes.',
    'shell.paneAria': 'Admin view',
    'shell.pane.edit': 'Edit',
    'shell.pane.preview': 'Preview',
    'shell.bootFailed': 'Admin failed to load. Reload the page.',
    'shell.viewError': 'This section failed to load. Reload the page to try again.',
    'lang.groupAria': 'Admin interface language',
    'lang.enTitle': 'English interface',
    'lang.arTitle': 'Arabic interface',

    // Unsaved-changes dialog
    'dirty.title': 'Unsaved changes',
    'dirty.msg': 'You have unsaved changes. If you leave now, they will be discarded.',
    'dirty.stay': 'Stay',
    'dirty.discard': 'Discard changes',

    // Live Preview chrome
    'preview.title': 'Live Preview',
    'preview.hint': 'Shows your saved public site.',
    'preview.page': 'Page',
    'preview.page.home': 'Home',
    'preview.page.menu': 'Menu',
    'preview.page.location': 'Location',
    'preview.page.contact': 'Contact',
    'preview.device': 'Device',
    'preview.device.desktop': 'Desktop',
    'preview.device.mobile': 'Mobile',
    'preview.language': 'Language',
    'preview.lang.en': 'English',
    'preview.frameTitle': 'Website preview',
    'preview.loadFailed': 'Preview page could not be loaded.',
    'preview.demo.portal': 'Portal Waves',
    'preview.demo.fade': 'Fade',
    'preview.demo.slide': 'Slide',
    'preview.demo.off': 'Transitions are OFF — pages load instantly',

    // Common
    'common.save': 'Save',
    'common.saving': 'Saving…',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.close': 'Close',
    'common.remove': 'Remove',
    'common.none': '— None —',
    'common.loading': 'Loading…',
    'common.viewInPreview': 'View in Preview',
    'common.moveUp': 'Move up',
    'common.moveDown': 'Move down',
    'common.saveFailed': 'Save failed. Please try again.',
    'common.updateFailed': 'Update failed. Please try again.',
    'common.deleteFailed': 'Delete failed. Please try again.',
    'upload.click': 'Click to upload',
    'upload.drag': 'or drag and drop',

    // Owner-safe errors (auth.js)
    'err.duplicate': 'That name is already in use. Please choose a different one.',
    'err.network': 'Network error. Please check your connection and try again.',
    'err.permission': 'You do not have permission to make this change.',
    'err.inUse': 'This item is still in use elsewhere and cannot be changed right now.',
    'err.generic': 'Something went wrong. Please try again.',
    'err.imageType': 'Image must be JPG, PNG, or WebP.',
    'err.imageSize': 'Image must be smaller than {mb} MB.',

    // Menu workspace
    'mw.title': 'Menu',
    'mw.desc': 'Manage the items and categories on your public menu.',
    'mw.tabsAria': 'Menu section',
    'mw.items': 'Menu Items',
    'mw.categories': 'Categories',

    // Menu Items
    'menu.desc': 'Manage all products on your public menu. Edits preview instantly; they go live only after you Save.',
    'menu.add': '+ Add Item',
    'menu.readOnly': 'Menu is read-only — the restaurant could not be loaded. Reload the page.',
    'menu.search': 'Search items…',
    'menu.allCategories': 'All categories',
    'menu.loadingDesc': 'Fetching your menu items.',
    'menu.modalAdd': 'Add Menu Item',
    'menu.modalEdit': 'Edit Menu Item',
    'menu.nameAr': 'Name (Arabic)',
    'menu.nameEn': 'Name (English)',
    'menu.descAr': 'Description (Arabic)',
    'menu.descEn': 'Description (English)',
    'menu.price': 'Price (﷼)',
    'menu.pricePh': 'e.g. 39 or 18.5',
    'menu.category': 'Category',
    'menu.sort': 'Sort Order',
    'menu.image': 'Product Image',
    'menu.imageNote': '(JPG · PNG · WebP · max 5 MB)',
    'menu.imageHint': '600×450 px recommended',
    'menu.imageAlt': 'Product preview',
    'menu.removeImage': 'Remove image',
    'menu.featured': 'Featured',
    'menu.featuredDesc': 'Shows on the homepage spotlight',
    'menu.available': 'Available',
    'menu.availableDesc': 'Visible on the public menu (uncheck to hide temporarily)',
    'menu.saveItem': 'Save Item',
    'menu.deleteTitle': 'Delete item?',
    'menu.deleteMsg': 'This will permanently remove the item from your menu. This cannot be undone.',
    'menu.deleteMsgNamed': '“{name}” will be permanently removed from your menu. This cannot be undone.',
    'menu.thisItem': 'This item',
    'menu.noResults': 'No results',
    'menu.noResultsDesc': 'Try clearing your filters.',
    'menu.empty': 'No items yet',
    'menu.emptyDesc': 'Add your first menu item to get started.',
    'menu.col.name': 'Name',
    'menu.col.category': 'Category',
    'menu.col.price': 'Price',
    'menu.col.status': 'Status',
    'menu.col.actions': 'Actions',
    'menu.badgeActive': 'Active',
    'menu.badgeHidden': 'Hidden',
    'menu.badgeFeatured': '★ Featured',
    'menu.hide': 'Hide',
    'menu.show': 'Show',
    'menu.someNotLoaded': 'Some menu data could not be loaded. Reload to retry.',
    'menu.loadFailed': 'Menu could not be loaded. Reload to retry.',
    'menu.notLoadedSave': 'Menu could not be loaded. Reload the page before saving.',
    'menu.nameRequired': 'Name (Arabic and English) is required.',
    'menu.priceRequired': 'Price is required.',
    'menu.updated': 'Item updated.',
    'menu.added': 'Item added.',
    'menu.hiddenToast': 'Item hidden from menu.',
    'menu.visibleToast': 'Item is now visible.',
    'menu.deleted': 'Item deleted.',

    // Categories
    'cat.desc': 'Categories let customers filter your menu. Renames preview live and go public when you Save.',
    'cat.readOnly': 'Categories are read-only — the restaurant could not be loaded. Reload the page.',
    'cat.addTitle': 'Add Category',
    'cat.nameEn': 'Category Name (English)',
    'cat.nameAr': 'Category Name (Arabic)',
    'cat.existing': 'Existing Categories',
    'cat.existingHint': '(Edit to rename · ↑ ↓ to reorder)',
    'cat.loadingDesc': 'Fetching your categories.',
    'cat.deleteTitle': 'Delete category?',
    'cat.deleteMsg': 'Products in this category will have their category cleared but will not be deleted.',
    'cat.deleteMsgNamed': '“{name}” will be deleted. Products in this category will have their category cleared but will NOT be deleted.',
    'cat.thisCategory': 'This category',
    'cat.empty': 'No categories yet',
    'cat.emptyDesc': 'Add your first category above.',
    'cat.bothRequired': 'Both English and Arabic names are required.',
    'cat.enRequired': 'English category name is required.',
    'cat.arRequired': 'Arabic category name is required.',
    'cat.renamed': 'Category renamed.',
    'cat.renameFailed': 'Rename failed. Please try again.',
    'cat.added': 'Category added.',
    'cat.addFailed': 'Could not add category. Please try again.',
    'cat.reorderFailed': 'Reorder failed. Please try again.',
    'cat.deleted': 'Category deleted.',
    'cat.loadFailed': 'Categories could not be loaded. Reload to retry.',

    // Settings — bar / global
    'set.clean': '✓ All changes saved',
    'set.dirty': '● Unsaved changes',
    'set.save': 'Save Changes',
    'set.hint': 'Edits appear in the Live Preview instantly; they go live on your public site only after you Save.',
    'set.readOnly': 'Settings are read-only — the restaurant could not be loaded. Reload the page.',
    'set.notLoadedSave': 'Restaurant settings could not be loaded. Reload the page before saving.',
    'set.nameRequired': 'Restaurant name (Arabic and English) is required.',
    'set.conflict': 'Someone else saved Settings changes after this page loaded. Reload the page to see the latest version, then make your changes again.',
    'set.saved': 'Settings saved successfully.',

    // Settings — Identity
    'set.identity': 'Identity',
    'set.nameAr': 'Name (Arabic)',
    'set.nameEn': 'Name (English)',
    'set.taglineAr': 'Tagline (Arabic)',
    'set.taglineEn': 'Tagline (English)',
    'set.descAr': 'Description (Arabic)',
    'set.descEn': 'Description (English)',
    'set.businessType': 'Business Type',
    'set.businessTypeHint': 'For your own reference — this does not change how your site looks yet.',
    'set.bt.restaurant': 'Restaurant',
    'set.bt.cafe': 'Cafe',
    'set.bt.bakery': 'Bakery',
    'set.bt.retail': 'Retail',
    'set.bt.clothing': 'Clothing',
    'set.bt.salon': 'Salon',
    'set.bt.services': 'Services',
    'set.bt.other': 'Other',

    // Settings — Content Labels
    'set.labels': 'Content Labels',
    'set.labelsHint': 'Leave any field blank to keep the current wording shown below it.',
    'set.catalogLabelEn': 'Catalog Label (English)',
    'set.catalogLabelAr': 'Catalog Label (Arabic)',
    'set.catalogLabelHint': 'Used for the main navigation link and the catalog page\'s eyebrow label. Examples: Menu, Products, Services, Collection.',
    'set.featuredTitleEn': 'Featured Section Title (English)',
    'set.featuredTitleAr': 'Featured Section Title (Arabic)',
    'set.featuredTitleHint': 'Shown above the homepage\'s highlighted items. Examples: Featured Dishes, Featured Products, Featured Services.',
    'set.catalogHeadingEn': 'Catalog Page Heading (English)',
    'set.catalogHeadingAr': 'Catalog Page Heading (Arabic)',
    'set.catalogHeadingHint': 'The main heading at the top of the full catalog page.',

    // Settings — Contact
    'set.contact': 'Contact',
    'set.phone': 'Phone',
    'set.phoneNote': '(display format)',
    'set.whatsapp': 'WhatsApp Number',
    'set.whatsappNote': '(digits only)',
    'set.instagram': 'Instagram',
    'set.email': 'Email',
    'set.emailNote': '(leave blank to hide)',
    'set.waAr': 'WhatsApp Pre-fill (Arabic)',
    'set.waEn': 'WhatsApp Pre-fill (English)',

    // Settings — Location
    'set.location': 'Location',
    'set.addressAr': 'Address (Arabic)',
    'set.addressEn': 'Address (English)',
    'set.mapLink': 'Google Maps Share Link',
    'set.mapLinkHint': 'Open Google Maps → Share → Copy link',
    'set.mapEmbed': 'Google Maps Embed URL',
    'set.mapEmbedNote': '(for the iframe)',
    'set.mapEmbedHint': 'Google Maps → Share → Embed a map → copy the src value from the iframe code',
    'set.locVisual': 'Location Visual',
    'set.locMap': 'Interactive Map',
    'set.locImage': 'Location Image',
    'set.locUploadHint': 'Restaurant exterior, storefront, entrance or interior · JPG, PNG or WebP · max 5 MB',
    'set.locImageAlt': 'Location image',
    'set.locFit': 'Image Display',
    'set.locFitContain': 'Fit Entire Image',
    'set.locFitCover': 'Fill Frame',
    'set.locHeight': 'Frame Height',
    'set.locShort': 'Short',
    'set.locStandard': 'Standard',
    'set.locTall': 'Tall',
    'set.locEdit': 'Edit Image in Preview',
    'set.locEditing': 'Editing in Preview…',
    'set.locFitHint': 'Fit Entire Image shows the whole photo; the edges are filled with a soft blur of the same photo so nothing is cropped.',
    'set.locRemove': 'Remove Location Image',
    'set.locImageHint': 'Shown on the public Location page instead of the map; clicking it opens your Google Maps Share Link.',

    // Settings — Opening Hours
    'set.hours': 'Opening Hours',
    'set.weekdaysEn': 'Weekdays (English)',
    'set.weekdaysAr': 'Weekdays (Arabic)',
    'set.weekendsEn': 'Weekends (English)',
    'set.weekendsAr': 'Weekends (Arabic)',

    // Settings — Images
    'set.images': 'Images',
    'set.hero': 'Hero Image',
    'set.heroNote': '(displayed on homepage)',
    'set.heroHint': 'JPG, PNG or WebP · max 5 MB · 1920×1080 px recommended',
    'set.heroAlt': 'Hero preview',
    'set.heroRemove': 'Remove Hero Image',
    'set.logo': 'Logo / Brand Image',
    'set.logoNote': '(optional)',
    'set.logoHint': 'JPG, PNG or WebP · max 5 MB · square format recommended',
    'set.logoAlt': 'Logo preview',
    'set.logoRemove': 'Remove Logo',

    // Settings — Homepage Statistics
    'stats.title': 'Homepage Statistics',
    'stats.hint': 'The quick facts shown near the top of your homepage. Order and visibility here match the public site.',
    'stats.undo': 'Undo',
    'stats.reset': 'Reset to default',
    'stats.add': '+ Add statistic',
    'stats.max': 'Maximum of {max} statistics.',
    'stats.overMax': 'You have {total} statistics. The maximum is {max} — remove some before adding more. Nothing is deleted until you Save.',
    'stats.empty': 'No statistics yet. Use “+ Add statistic”, or “Reset to default”.',
    'stats.card': 'Statistic {n}',
    'stats.summary': '{type} · {value}',
    'stats.summaryHidden': '{type} · {value} · hidden',
    'stats.show': 'Show on website',
    'stats.showDesc': 'Uncheck to hide this from your homepage.',
    'stats.showAria': 'Show statistic {n} on website',
    'stats.style': 'Display style',
    'stats.type.custom': 'Custom text',
    'stats.type.percent': 'Percentage',
    'stats.type.plus': 'Number with +',
    'stats.type.rating': 'Rating out of 5',
    'stats.type.number': 'Plain number',
    'stats.value': 'Value',
    'stats.valuePercent': 'Percentage',
    'stats.valueNumber': 'Number',
    'stats.valueRating': 'Rating (out of 5)',
    'stats.valueText': 'Text',
    'stats.valueTextPh': 'e.g. 24/7, Since 1998, Free',
    'stats.labelEn': 'Label (English)',
    'stats.labelAr': 'Label (Arabic)',
    'stats.moveUp': '↑ Move up',
    'stats.moveDown': '↓ Move down',
    'stats.upAria': 'Move statistic {n} up',
    'stats.downAria': 'Move statistic {n} down',
    'stats.removeAria': 'Remove statistic {n}',

    // Settings — App (customer sounds)
    'set.app': 'App Settings',
    'set.sounds': 'Customer Site Sounds',
    'set.soundsDesc': 'Play subtle interaction sounds for customers using the website.',

    // Settings — Page Transition
    'tr.title': 'Page Transition',
    'tr.enable': 'Enable Transitions',
    'tr.enableDesc': 'Play an animated hand-off between pages on the public site.',
    'tr.style': 'Transition Style',
    'tr.portal': 'Portal Waves',
    'tr.fade': 'Fade',
    'tr.slide': 'Slide',
    'tr.color': 'Transition Color',
    'tr.colorPickerAria': 'Transition color picker',
    'tr.colorHexAria': 'Transition color (hex)',
    'tr.colorHint': 'Used by Portal Waves only. Must be a valid hex color, e.g. #d4af65 — invalid values fall back to the default gold on Save.',
    'tr.preview': 'Preview Transition',
    'tr.previewHint': 'Demonstrates the transition above inside the Live Preview — nothing is sent to your public site.',

    // Login
    'login.docTitle': 'Admin Login — Taste The West',
    'login.sub': 'Owner Dashboard — sign in to continue',
    'login.email': 'Email address',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.signingIn': 'Signing in…',
    'login.missing': 'Please enter your email and password.',
    'login.invalid': 'Invalid email or password. Please try again.',
  };

  var AR = {
    'shell.docTitle': 'لوحة الإدارة — Taste The West',
    'shell.navAria': 'أقسام لوحة الإدارة',
    'shell.nav.menu': 'القائمة',
    'shell.nav.settings': 'الإعدادات',
    'shell.viewSite': 'عرض الموقع',
    'shell.signOut': 'تسجيل الخروج',
    'shell.soundOn': 'أصوات لوحة الإدارة مفعّلة',
    'shell.soundOff': 'أصوات لوحة الإدارة متوقفة',
    'shell.loadBanner': 'تعذّر تحميل إعدادات المطعم. أعد تحميل الصفحة قبل إجراء أي تغييرات.',
    'shell.paneAria': 'عرض لوحة الإدارة',
    'shell.pane.edit': 'تحرير',
    'shell.pane.preview': 'المعاينة',
    'shell.bootFailed': 'تعذّر تحميل لوحة الإدارة. أعد تحميل الصفحة.',
    'shell.viewError': 'تعذّر تحميل هذا القسم. أعد تحميل الصفحة للمحاولة مرة أخرى.',
    'lang.groupAria': 'لغة واجهة الإدارة',
    'lang.enTitle': 'الواجهة بالإنجليزية',
    'lang.arTitle': 'الواجهة بالعربية',

    'dirty.title': 'تغييرات غير محفوظة',
    'dirty.msg': 'لديك تغييرات غير محفوظة. إذا غادرت الآن فسيتم تجاهلها.',
    'dirty.stay': 'البقاء',
    'dirty.discard': 'تجاهل التغييرات',

    'preview.title': 'المعاينة المباشرة',
    'preview.hint': 'تعرض موقعك العام المحفوظ.',
    'preview.page': 'الصفحة',
    'preview.page.home': 'الرئيسية',
    'preview.page.menu': 'القائمة',
    'preview.page.location': 'الموقع',
    'preview.page.contact': 'التواصل',
    'preview.device': 'الجهاز',
    'preview.device.desktop': 'سطح المكتب',
    'preview.device.mobile': 'الجوال',
    'preview.language': 'اللغة',
    'preview.lang.en': 'الإنجليزية',
    'preview.frameTitle': 'معاينة الموقع',
    'preview.loadFailed': 'تعذّر تحميل صفحة المعاينة.',
    'preview.demo.portal': 'أمواج البوابة',
    'preview.demo.fade': 'تلاشي',
    'preview.demo.slide': 'انزلاق',
    'preview.demo.off': 'الانتقالات متوقفة — تنتقل الصفحات فوراً',

    'common.save': 'حفظ',
    'common.saving': 'جارٍ الحفظ…',
    'common.cancel': 'إلغاء',
    'common.delete': 'حذف',
    'common.edit': 'تعديل',
    'common.close': 'إغلاق',
    'common.remove': 'إزالة',
    'common.none': '— بدون —',
    'common.loading': 'جارٍ التحميل…',
    'common.viewInPreview': 'عرض في المعاينة',
    'common.moveUp': 'نقل للأعلى',
    'common.moveDown': 'نقل للأسفل',
    'common.saveFailed': 'تعذّر الحفظ. يُرجى المحاولة مرة أخرى.',
    'common.updateFailed': 'تعذّر التحديث. يُرجى المحاولة مرة أخرى.',
    'common.deleteFailed': 'تعذّر الحذف. يُرجى المحاولة مرة أخرى.',
    'upload.click': 'انقر لرفع صورة',
    'upload.drag': 'أو اسحبها وأفلتها هنا',

    'err.duplicate': 'هذا الاسم مستخدم بالفعل. يُرجى اختيار اسم آخر.',
    'err.network': 'خطأ في الشبكة. يُرجى التحقق من اتصالك والمحاولة مرة أخرى.',
    'err.permission': 'ليست لديك صلاحية لإجراء هذا التغيير.',
    'err.inUse': 'هذا العنصر مستخدم في مكان آخر ولا يمكن تغييره حالياً.',
    'err.generic': 'حدث خطأ ما. يُرجى المحاولة مرة أخرى.',
    'err.imageType': 'يجب أن تكون الصورة بصيغة JPG أو PNG أو WebP.',
    'err.imageSize': 'يجب أن يكون حجم الصورة أقل من {mb} ميغابايت.',

    'mw.title': 'القائمة',
    'mw.desc': 'أدِر الأصناف والفئات المعروضة في قائمتك العامة.',
    'mw.tabsAria': 'قسم القائمة',
    'mw.items': 'أصناف القائمة',
    'mw.categories': 'الفئات',

    'menu.desc': 'أدِر جميع المنتجات في قائمتك العامة. تظهر التعديلات في المعاينة فوراً، ولا تُنشر إلا بعد الحفظ.',
    'menu.add': '+ إضافة صنف',
    'menu.readOnly': 'القائمة للقراءة فقط — تعذّر تحميل بيانات المطعم. أعد تحميل الصفحة.',
    'menu.search': 'ابحث في الأصناف…',
    'menu.allCategories': 'جميع الفئات',
    'menu.loadingDesc': 'جارٍ جلب أصناف قائمتك.',
    'menu.modalAdd': 'إضافة صنف',
    'menu.modalEdit': 'تعديل صنف',
    'menu.nameAr': 'الاسم (العربية)',
    'menu.nameEn': 'الاسم (الإنجليزية)',
    'menu.descAr': 'الوصف (العربية)',
    'menu.descEn': 'الوصف (الإنجليزية)',
    'menu.price': 'السعر (﷼)',
    'menu.pricePh': 'مثال: 39 أو 18.5',
    'menu.category': 'الفئة',
    'menu.sort': 'ترتيب العرض',
    'menu.image': 'صورة المنتج',
    'menu.imageNote': '(JPG · PNG · WebP · بحد أقصى 5 ميغابايت)',
    'menu.imageHint': 'المقاس المقترح 600×450 بكسل',
    'menu.imageAlt': 'معاينة المنتج',
    'menu.removeImage': 'إزالة الصورة',
    'menu.featured': 'مميّز',
    'menu.featuredDesc': 'يظهر ضمن الأصناف المميّزة في الصفحة الرئيسية',
    'menu.available': 'متوفر',
    'menu.availableDesc': 'ظاهر في القائمة العامة (ألغِ التحديد لإخفائه مؤقتاً)',
    'menu.saveItem': 'حفظ الصنف',
    'menu.deleteTitle': 'حذف الصنف؟',
    'menu.deleteMsg': 'سيُحذف هذا الصنف من قائمتك نهائياً. لا يمكن التراجع عن ذلك.',
    'menu.deleteMsgNamed': 'سيُحذف «{name}» من قائمتك نهائياً. لا يمكن التراجع عن ذلك.',
    'menu.thisItem': 'هذا الصنف',
    'menu.noResults': 'لا توجد نتائج',
    'menu.noResultsDesc': 'جرّب مسح عوامل التصفية.',
    'menu.empty': 'لا توجد أصناف بعد',
    'menu.emptyDesc': 'أضف أول صنف إلى قائمتك للبدء.',
    'menu.col.name': 'الاسم',
    'menu.col.category': 'الفئة',
    'menu.col.price': 'السعر',
    'menu.col.status': 'الحالة',
    'menu.col.actions': 'الإجراءات',
    'menu.badgeActive': 'ظاهر',
    'menu.badgeHidden': 'مخفي',
    'menu.badgeFeatured': '★ مميّز',
    'menu.hide': 'إخفاء',
    'menu.show': 'إظهار',
    'menu.someNotLoaded': 'تعذّر تحميل بعض بيانات القائمة. أعد التحميل للمحاولة مجدداً.',
    'menu.loadFailed': 'تعذّر تحميل القائمة. أعد التحميل للمحاولة مجدداً.',
    'menu.notLoadedSave': 'تعذّر تحميل القائمة. أعد تحميل الصفحة قبل الحفظ.',
    'menu.nameRequired': 'الاسم مطلوب بالعربية والإنجليزية.',
    'menu.priceRequired': 'السعر مطلوب.',
    'menu.updated': 'تم تحديث الصنف.',
    'menu.added': 'تمت إضافة الصنف.',
    'menu.hiddenToast': 'تم إخفاء الصنف من القائمة.',
    'menu.visibleToast': 'أصبح الصنف ظاهراً الآن.',
    'menu.deleted': 'تم حذف الصنف.',

    'cat.desc': 'تتيح الفئات لعملائك تصفية قائمتك. تظهر إعادة التسمية في المعاينة مباشرة وتُنشر عند الحفظ.',
    'cat.readOnly': 'الفئات للقراءة فقط — تعذّر تحميل بيانات المطعم. أعد تحميل الصفحة.',
    'cat.addTitle': 'إضافة فئة',
    'cat.nameEn': 'اسم الفئة (الإنجليزية)',
    'cat.nameAr': 'اسم الفئة (العربية)',
    'cat.existing': 'الفئات الحالية',
    'cat.existingHint': '(«تعديل» لإعادة التسمية · ↑ ↓ لإعادة الترتيب)',
    'cat.loadingDesc': 'جارٍ جلب فئاتك.',
    'cat.deleteTitle': 'حذف الفئة؟',
    'cat.deleteMsg': 'ستُزال هذه الفئة من المنتجات التابعة لها، لكن المنتجات نفسها لن تُحذف.',
    'cat.deleteMsgNamed': 'ستُحذف الفئة «{name}». ستُزال من المنتجات التابعة لها، لكن المنتجات نفسها لن تُحذف.',
    'cat.thisCategory': 'هذه الفئة',
    'cat.empty': 'لا توجد فئات بعد',
    'cat.emptyDesc': 'أضف أول فئة من النموذج أعلاه.',
    'cat.bothRequired': 'الاسم مطلوب بالإنجليزية والعربية.',
    'cat.enRequired': 'اسم الفئة بالإنجليزية مطلوب.',
    'cat.arRequired': 'اسم الفئة بالعربية مطلوب.',
    'cat.renamed': 'تمت إعادة تسمية الفئة.',
    'cat.renameFailed': 'تعذّرت إعادة التسمية. يُرجى المحاولة مرة أخرى.',
    'cat.added': 'تمت إضافة الفئة.',
    'cat.addFailed': 'تعذّرت إضافة الفئة. يُرجى المحاولة مرة أخرى.',
    'cat.reorderFailed': 'تعذّرت إعادة الترتيب. يُرجى المحاولة مرة أخرى.',
    'cat.deleted': 'تم حذف الفئة.',
    'cat.loadFailed': 'تعذّر تحميل الفئات. أعد التحميل للمحاولة مجدداً.',

    'set.clean': '✓ تم حفظ جميع التغييرات',
    'set.dirty': '● تغييرات غير محفوظة',
    'set.save': 'حفظ التغييرات',
    'set.hint': 'تظهر التعديلات في المعاينة المباشرة فوراً، ولا تُنشر على موقعك العام إلا بعد الحفظ.',
    'set.readOnly': 'الإعدادات للقراءة فقط — تعذّر تحميل بيانات المطعم. أعد تحميل الصفحة.',
    'set.notLoadedSave': 'تعذّر تحميل إعدادات المطعم. أعد تحميل الصفحة قبل الحفظ.',
    'set.nameRequired': 'اسم المطعم مطلوب بالعربية والإنجليزية.',
    'set.conflict': 'حفظ شخص آخر تغييرات على الإعدادات بعد تحميل هذه الصفحة. أعد تحميل الصفحة لعرض أحدث نسخة، ثم أجرِ تغييراتك مرة أخرى.',
    'set.saved': 'تم حفظ الإعدادات بنجاح.',

    'set.identity': 'الهوية',
    'set.nameAr': 'الاسم (العربية)',
    'set.nameEn': 'الاسم (الإنجليزية)',
    'set.taglineAr': 'الشعار النصي (العربية)',
    'set.taglineEn': 'الشعار النصي (الإنجليزية)',
    'set.descAr': 'الوصف (العربية)',
    'set.descEn': 'الوصف (الإنجليزية)',
    'set.businessType': 'نوع النشاط التجاري',
    'set.businessTypeHint': 'لغرض الرجوع فقط — لا يغيّر هذا شكل موقعك حالياً.',
    'set.bt.restaurant': 'مطعم',
    'set.bt.cafe': 'مقهى',
    'set.bt.bakery': 'مخبز',
    'set.bt.retail': 'تجزئة',
    'set.bt.clothing': 'ملابس',
    'set.bt.salon': 'صالون',
    'set.bt.services': 'خدمات',
    'set.bt.other': 'أخرى',

    'set.labels': 'تسميات المحتوى',
    'set.labelsHint': 'اترك أي حقل فارغاً للإبقاء على النص الحالي الموضّح تحته.',
    'set.catalogLabelEn': 'تسمية الكتالوج (الإنجليزية)',
    'set.catalogLabelAr': 'تسمية الكتالوج (العربية)',
    'set.catalogLabelHint': 'تُستخدم لرابط التنقل الرئيسي وللعنوان التمهيدي في صفحة الكتالوج. أمثلة: القائمة، المنتجات، الخدمات، التشكيلة.',
    'set.featuredTitleEn': 'عنوان القسم المميّز (الإنجليزية)',
    'set.featuredTitleAr': 'عنوان القسم المميّز (العربية)',
    'set.featuredTitleHint': 'يظهر فوق العناصر المميّزة في الصفحة الرئيسية. أمثلة: أطباق مميّزة، منتجات مميّزة، خدمات مميّزة.',
    'set.catalogHeadingEn': 'عنوان صفحة الكتالوج (الإنجليزية)',
    'set.catalogHeadingAr': 'عنوان صفحة الكتالوج (العربية)',
    'set.catalogHeadingHint': 'العنوان الرئيسي أعلى صفحة الكتالوج الكاملة.',

    'set.contact': 'معلومات التواصل',
    'set.phone': 'الهاتف',
    'set.phoneNote': '(صيغة العرض)',
    'set.whatsapp': 'رقم واتساب',
    'set.whatsappNote': '(أرقام فقط)',
    'set.instagram': 'إنستغرام',
    'set.email': 'البريد الإلكتروني',
    'set.emailNote': '(اتركه فارغاً لإخفائه)',
    'set.waAr': 'رسالة واتساب الجاهزة (العربية)',
    'set.waEn': 'رسالة واتساب الجاهزة (الإنجليزية)',

    'set.location': 'الموقع',
    'set.addressAr': 'العنوان (العربية)',
    'set.addressEn': 'العنوان (الإنجليزية)',
    'set.mapLink': 'رابط المشاركة من خرائط Google',
    'set.mapLinkHint': 'افتح خرائط Google ← مشاركة ← نسخ الرابط',
    'set.mapEmbed': 'رابط تضمين خرائط Google',
    'set.mapEmbedNote': '(لإطار الخريطة)',
    'set.mapEmbedHint': 'خرائط Google ← مشاركة ← تضمين خريطة ← انسخ قيمة src من كود الإطار',
    'set.locVisual': 'العرض المرئي للموقع',
    'set.locMap': 'خريطة تفاعلية',
    'set.locImage': 'صورة الموقع',
    'set.locUploadHint': 'واجهة المطعم أو المتجر أو المدخل أو الداخل · JPG أو PNG أو WebP · بحد أقصى 5 ميغابايت',
    'set.locImageAlt': 'صورة الموقع',
    'set.locFit': 'طريقة عرض الصورة',
    'set.locFitContain': 'إظهار الصورة كاملة',
    'set.locFitCover': 'ملء الإطار',
    'set.locHeight': 'ارتفاع الإطار',
    'set.locShort': 'قصير',
    'set.locStandard': 'قياسي',
    'set.locTall': 'طويل',
    'set.locEdit': 'تعديل الصورة في المعاينة',
    'set.locEditing': 'جارٍ التعديل في المعاينة…',
    'set.locFitHint': 'خيار «إظهار الصورة كاملة» يعرض الصورة بالكامل، وتُملأ الحواف بنسخة ضبابية خفيفة من الصورة نفسها فلا يُقتطع منها شيء.',
    'set.locRemove': 'إزالة صورة الموقع',
    'set.locImageHint': 'تظهر في صفحة الموقع العامة بدلاً من الخريطة، والنقر عليها يفتح رابط المشاركة من خرائط Google.',

    'set.hours': 'ساعات العمل',
    'set.weekdaysEn': 'أيام الأسبوع (الإنجليزية)',
    'set.weekdaysAr': 'أيام الأسبوع (العربية)',
    'set.weekendsEn': 'عطلة نهاية الأسبوع (الإنجليزية)',
    'set.weekendsAr': 'عطلة نهاية الأسبوع (العربية)',

    'set.images': 'الصور',
    'set.hero': 'الصورة الرئيسية',
    'set.heroNote': '(تظهر في الصفحة الرئيسية)',
    'set.heroHint': 'JPG أو PNG أو WebP · بحد أقصى 5 ميغابايت · المقاس المقترح 1920×1080 بكسل',
    'set.heroAlt': 'معاينة الصورة الرئيسية',
    'set.heroRemove': 'إزالة الصورة الرئيسية',
    'set.logo': 'الشعار / صورة العلامة التجارية',
    'set.logoNote': '(اختياري)',
    'set.logoHint': 'JPG أو PNG أو WebP · بحد أقصى 5 ميغابايت · يُفضّل مقاس مربع',
    'set.logoAlt': 'معاينة الشعار',
    'set.logoRemove': 'إزالة الشعار',

    'stats.title': 'إحصائيات الصفحة الرئيسية',
    'stats.hint': 'الحقائق السريعة المعروضة أعلى صفحتك الرئيسية. يطابق الترتيب وحالة الظهور هنا ما يظهر في الموقع العام.',
    'stats.undo': 'تراجع',
    'stats.reset': 'استعادة الافتراضي',
    'stats.add': '+ إضافة إحصائية',
    'stats.max': 'الحد الأقصى {max} إحصائيات.',
    'stats.overMax': 'لديك {total} إحصائيات والحد الأقصى {max} — احذف بعضها قبل إضافة المزيد. لن يُحذف شيء قبل الحفظ.',
    'stats.empty': 'لا توجد إحصائيات بعد. استخدم «+ إضافة إحصائية» أو «استعادة الافتراضي».',
    'stats.card': 'الإحصائية {n}',
    'stats.summary': '{type} · {value}',
    'stats.summaryHidden': '{type} · {value} · مخفية',
    'stats.show': 'إظهار في الموقع',
    'stats.showDesc': 'ألغِ التحديد لإخفائها من صفحتك الرئيسية.',
    'stats.showAria': 'إظهار الإحصائية {n} في الموقع',
    'stats.style': 'نمط العرض',
    'stats.type.custom': 'نص مخصص',
    'stats.type.percent': 'نسبة مئوية',
    'stats.type.plus': 'رقم مع +',
    'stats.type.rating': 'تقييم من 5',
    'stats.type.number': 'رقم فقط',
    'stats.value': 'القيمة',
    'stats.valuePercent': 'النسبة المئوية',
    'stats.valueNumber': 'الرقم',
    'stats.valueRating': 'التقييم (من 5)',
    'stats.valueText': 'النص',
    'stats.valueTextPh': 'مثال: 24/7، منذ 1998، مجاناً',
    'stats.labelEn': 'التسمية (الإنجليزية)',
    'stats.labelAr': 'التسمية (العربية)',
    'stats.moveUp': '↑ نقل للأعلى',
    'stats.moveDown': '↓ نقل للأسفل',
    'stats.upAria': 'نقل الإحصائية {n} للأعلى',
    'stats.downAria': 'نقل الإحصائية {n} للأسفل',
    'stats.removeAria': 'إزالة الإحصائية {n}',

    'set.app': 'إعدادات التطبيق',
    'set.sounds': 'أصوات موقع العملاء',
    'set.soundsDesc': 'تشغيل أصوات تفاعل خفيفة للعملاء أثناء تصفح الموقع.',

    'tr.title': 'انتقال الصفحات',
    'tr.enable': 'تفعيل الانتقالات',
    'tr.enableDesc': 'تشغيل انتقال متحرك بين صفحات الموقع العام.',
    'tr.style': 'نمط الانتقال',
    'tr.portal': 'أمواج البوابة',
    'tr.fade': 'تلاشي',
    'tr.slide': 'انزلاق',
    'tr.color': 'لون الانتقال',
    'tr.colorPickerAria': 'منتقي لون الانتقال',
    'tr.colorHexAria': 'لون الانتقال (سداسي عشري)',
    'tr.colorHint': 'يُستخدم في نمط «أمواج البوابة» فقط. يجب أن يكون لوناً سداسياً صحيحاً مثل ‎#d4af65‎ — القيم غير الصحيحة تعود إلى اللون الذهبي الافتراضي عند الحفظ.',
    'tr.preview': 'معاينة الانتقال',
    'tr.previewHint': 'يعرض الانتقال المحدد أعلاه داخل المعاينة المباشرة فقط — لا يُرسل شيء إلى موقعك العام.',

    'login.docTitle': 'تسجيل الدخول — Taste The West',
    'login.sub': 'لوحة تحكم المالك — سجّل الدخول للمتابعة',
    'login.email': 'البريد الإلكتروني',
    'login.password': 'كلمة المرور',
    'login.submit': 'تسجيل الدخول',
    'login.signingIn': 'جارٍ تسجيل الدخول…',
    'login.missing': 'يُرجى إدخال البريد الإلكتروني وكلمة المرور.',
    'login.invalid': 'البريد الإلكتروني أو كلمة المرور غير صحيحة. يُرجى المحاولة مرة أخرى.',
  };

  var DICTS = { en: EN, ar: AR };

  // ── Persistence (UI-only, per device/browser) ───────────────────
  function readUi() {
    try {
      var o = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }
  function persist(lang) {
    // Merge into the shared blob — never clobber the shell's own keys.
    try {
      var o = readUi();
      o.adminLang = lang;
      localStorage.setItem(UI_KEY, JSON.stringify(o));
    } catch (e) { /* private mode / storage disabled — best-effort */ }
  }
  function norm(lang) { return lang === 'ar' ? 'ar' : 'en'; }

  var current = norm(readUi().adminLang);
  var listeners = [];

  // ── Lookup ──────────────────────────────────────────────────────
  function t(key, vars) {
    var d = DICTS[current];
    var s = Object.prototype.hasOwnProperty.call(d, key) ? d[key]
          : (Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : key);
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        if (!Object.prototype.hasOwnProperty.call(vars, name)) return m;
        var v = vars[name];
        if (v && typeof v === 'object' && typeof v.key === 'string') return t(v.key);
        return String(v == null ? '' : v);
      });
    }
    return s;
  }

  // ── DOM helpers ─────────────────────────────────────────────────
  function varsOf(el) {
    var raw = el.getAttribute('data-i18n-vars');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  // Replace only the element's first non-blank text node when it also has
  // child elements (keeps <span class="required">, <small>, spinners).
  function setText(el, value) {
    if (!el.firstElementChild) { el.textContent = value; return; }
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3 && n.nodeValue.trim() !== '') {
        var lead = n.nodeValue.match(/^\s*/)[0];
        var trail = n.nodeValue.match(/\s*$/)[0];
        n.nodeValue = lead + value + trail;
        return;
      }
    }
    el.appendChild(document.createTextNode(' ' + value));
  }
  // Localized text direction on the text's OWN element — never on the layout.
  function setDir(el) {
    if (el.tagName === 'TITLE') return;
    if (current === 'ar') {
      el.setAttribute('dir', 'rtl');
      el.setAttribute('lang', 'ar');
    } else {
      el.removeAttribute('dir');
      el.removeAttribute('lang');
    }
  }
  function translateEl(el) {
    var vars = varsOf(el);
    var key = el.getAttribute('data-i18n');
    if (key) setText(el, t(key, vars));
    for (var i = 0; i < ATTRS.length; i++) {
      var k = el.getAttribute('data-i18n-' + ATTRS[i]);
      if (k) el.setAttribute(ATTRS[i], t(k, vars));
    }
    if (key || el.hasAttribute('data-i18n-dir')) setDir(el);
  }
  var SEL = '[data-i18n],[data-i18n-dir],' + ATTRS.map(function (a) { return '[data-i18n-' + a + ']'; }).join(',');
  function apply(root) {
    root = root || document;
    if (root.nodeType === 1 && root.matches(SEL)) translateEl(root);
    var list = root.querySelectorAll(SEL);
    for (var i = 0; i < list.length; i++) translateEl(list[i]);
  }
  // Stamp + translate one element's text (the stamp keeps it live-switchable).
  function set(el, key, vars) {
    if (!el) return;
    el.setAttribute('data-i18n', key);
    if (vars) el.setAttribute('data-i18n-vars', JSON.stringify(vars));
    else el.removeAttribute('data-i18n-vars');
    translateEl(el);
  }
  function setAttr(el, attr, key, vars) {
    if (!el) return;
    el.setAttribute('data-i18n-' + attr, key);
    if (vars) el.setAttribute('data-i18n-vars', JSON.stringify(vars));
    translateEl(el);
  }

  // ── Document-level state + the toggle controls ──────────────────
  function syncRoot() {
    var html = document.documentElement;
    html.setAttribute('lang', current);
    html.setAttribute('data-admin-lang', current);   // CSS hook; never dir=rtl on the document
    var btns = document.querySelectorAll('[data-ui-lang]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-ui-lang') === current;
      btns[i].classList.toggle('is-active', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function getLang() { return current; }

  // UI-only: re-translates stamped DOM in place. Never re-mounts a view, never
  // fires input/change, never touches form values, drafts or the network.
  function setLang(lang) {
    lang = norm(lang);
    if (LANGS.indexOf(lang) === -1) return current;
    persist(lang);
    if (lang === current) { syncRoot(); return current; }
    current = lang;
    syncRoot();
    apply(document);
    listeners.slice().forEach(function (fn) { try { fn(current); } catch (e) { console.error('[i18n] listener error:', e); } });
    return current;
  }
  function onChange(fn) {
    listeners.push(fn);
    return function off() { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
  }

  // Delegated toggle wiring — works for any [data-ui-lang] button on any page.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-ui-lang]');
    if (b) setLang(b.getAttribute('data-ui-lang'));
  });

  // Loaded at the end of <body>: the static markup is already parsed.
  syncRoot();
  apply(document);

  return {
    LANGS: LANGS.slice(),
    t: t,
    getLang: getLang,
    setLang: setLang,
    apply: apply,
    set: set,
    setAttr: setAttr,
    onChange: onChange,
    _dicts: DICTS,   // exposed for the key-parity test only
  };
})();
