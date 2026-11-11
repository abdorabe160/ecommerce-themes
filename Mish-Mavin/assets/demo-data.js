/* Mish-Mavin — بيانات توضيحية للمعاينة فقط (qumra theme dev / محرر الثيم).
   تُحمَّل ديناميكياً من main.js عند isPreview() فقط، ولا تُحمَّل للعملاء على المتجر الحي.
   منتجات افتراضية عامة (بدون أي براند حقيقي). الصور حقيقية من Burst — مكتبة الصور المجانية من Shopify
   (مسموح استخدامها تجارياً): https://www.shopify.com/stock-photos
   كل لون ليه صوره الخاصة (colorImages[i] ↔ swatches[i]) فاختيار اللون بيغيّر الصورة في الكارت وصفحة المنتج. */
(function () {
  // قص 3:4 من الـ CDN بنفس مقاس كروت الثيم
  function B(slug) { return 'https://burst.shopifycdn.com/photos/' + slug + '.jpg?width=720&height=960&crop=center&format=pjpg&exif=0&iptc=0'; }
  var S = ['S', 'M', 'L', 'XL'];

  /* [id, title, fit, price, compare, rating, reviews, [[colorName, hex, [photo slugs]], ...]] */
  var CATALOG = [
    [1, 'Core Crew Tee', 'Regular Fit', 450, 550, 4.6, 64, [
      ['Grey', '#6e7a74', ['grey-t-shirt']],
      ['Green', '#5b8a55', ['green-t-shirt']],
      ['Blue', '#4b6a92', ['blue-t-shirt']],
      ['Red', '#e3262b', ['red-t-shirt']]]],
    [2, 'Heather Crew Tee', 'Regular Fit', 490, 0, 4.4, 21, [
      ['Teal', '#2f8f6a', ['teal-t-shirt']],
      ['Purple', '#6b4f8f', ['purple-t-shirt']],
      ['Light Green', '#79a26b', ['light-green-t-shirt']],
      ['Cobalt', '#3d5f96', ['cobalt-blue-t-shirt']]]],
    [3, 'Classic Cotton Tee', 'Regular Fit', 520, 650, 4.8, 37, [
      ['White', '#f4f4f4', ['back-of-mens-white-shirt']],
      ['Red', '#d8232a', ['red-t-shirt']]]],
    [5, 'Everyday Plain Tee', 'Regular Fit', 390, 450, 4.5, 48, [
      ['Black', '#111111', ['close-up-portrait-of-young-adult-in-black-tee']],
      ['White', '#ffffff', ['person-in-a-white-t-shirt-looks-left-against-brick-wall', 'back-of-mens-white-shirt']]]],
    [6, 'Heavyweight Hoodie', 'Oversized Fit', 1250, 1450, 4.8, 93, [
      ['Black', '#111111', ['fall-mens-casual-hoodie-fashion', 'casual-fall-mens-fashion']],
      ['Tan', '#c8b49a', ['man-in-tan-hoodie-looks-up-at-camera', 'close-up-of-man-in-tan-hoodie']],
      ['Grey Marl', '#d9d9d9', ['man-in-hoodie-sits-with-hand-to-chin', 'close-up-grey-marl-hoodie']]]],
    [7, 'Cloud Fleece Sweatpants', 'Relaxed Fit', 890, 980, 4.6, 41, [
      ['Light Grey', '#d9d9d9', ['matching-hoodie-and-sweatpants', 'man-on-stool-in-hoodie-and-sweatpants']],
      ['Sand', '#e3d6c3', ['man-in-white-and-light-tan-outfit']]]],
    [8, 'Neon Street Hoodie', 'Regular Fit', 1150, 0, 4.2, 9, [
      ['Burgundy', '#7a1f2b', ['urban-mens-fashion-on-young-adult', 'young-men-s-urban-fashion']]]],
    [9, 'Zip Up Hoodie', 'Regular Fit', 1190, 1350, 4.4, 15, [
      ['Yellow', '#f5c518', ['person-in-yellow-leans-against-graffiti-covered-wall']]]],
    [10, 'Classic Crew Sweatshirt', 'Regular Fit', 950, 0, 4.1, 18, [
      ['Black', '#111111', ['rail-of-black-sweatshirts', 'hand-reaches-for-hanging-sweatshirt']]]],
    [11, 'Ribbed Tank Top', 'Slim Fit', 350, 450, 4.3, 26, [
      ['Charcoal', '#4a4a4a', ['fitness-workout']]]],
    [12, 'Performance Training Tee', 'Compression Fit', 550, 690, 4.7, 112, [
      ['White', '#ffffff', ['upper-body-fitness', 'fitness-weight-lifting']]]],
    [13, 'Pro Compression Tee', 'Compression Fit', 590, 0, 4.5, 34, [
      ['White', '#ffffff', ['lifting-weights', 'man-working-out-with-weights']]]],
    [14, 'Power Muscle Tank', 'Oversized Fit', 420, 520, 4.4, 22, [
      ['Charcoal', '#4a4a4a', ['rope-workout', 'intense-exercise']]]],
    [15, 'Dry-Fit Running Tee', 'Athletic Fit', 590, 690, 4.6, 29, [
      ['Black', '#111111', ['person-in-black-running-in-the-green-outdoors']],
      ['White', '#ffffff', ['man-running-at-the-track']]]],
    [16, 'Flex Training Shorts', 'Regular Fit', 520, 650, 4.5, 31, [
      ['Black', '#111111', ['upper-body-work-out', 'man-works-out-hard']]]],
    [17, 'Court Basketball Shorts', 'Relaxed Fit', 550, 0, 4.2, 11, [
      ['Black', '#111111', ['basketball-player']]]],
    [18, 'Beach Swim Shorts', 'Regular Fit', 480, 600, 4.6, 19, [
      ['Turquoise', '#2ec4a6', ['swim-shorts']],
      ['Tropical', '#2b3f8f', ['tropical-print-mens-swimwear']]]],
    [19, 'Training Muscle Tank', 'Regular Fit', 390, 0, 4.3, 14, [
      ['Grey', '#8a9097', ['fitness-man-chin-ups']]]]
  ];

  var P = {};
  CATALOG.forEach(function (r) {
    var colors = r[7];
    P[r[0]] = {
      _id: 'demo-' + r[0], title: r[1], fit: r[2], price: r[3], compare: r[4], rating: r[5], reviews: r[6], sizes: S,
      swatches: colors.map(function (c) { return c[1]; }),
      colorNames: colors.map(function (c) { return c[0]; }),
      colorImages: colors.map(function (c) { return c[2].map(B); })
    };
  });
  function set(ids) { return ids.map(function (i) { return P[i]; }); }

  window.MW_DEMO = {
    imageBase: '',
    sets: {
      new: set([6, 1, 18, 13, 15, 3, 7, 19, 9, 17]),
      best: set([1, 6, 3, 12, 13, 5, 7, 18]),
      tops: set([1, 2, 3, 5, 15, 12, 6, 8, 9, 10]),
      compressions: set([12, 13, 15, 14]),
      tanks: set([11, 14, 19]),
      bottoms: set([7, 16, 17, 18]),
      look: set([6, 7])
    },
    cats: [
      { title: 'Tops', image: B('green-t-shirt') },
      { title: 'Compression', image: B('upper-body-fitness') },
      { title: 'Tanks', image: B('fitness-workout') },
      { title: 'Bottoms', image: B('matching-hoodie-and-sweatpants') }
    ],
    fcols: [
      { title: 'إصدار جديد', image: B('man-in-tan-hoodie-looks-up-at-camera') },
      { title: 'Tshirts', image: B('person-in-a-white-t-shirt-looks-left-against-brick-wall') },
      { title: 'Compressions', image: B('fitness-weight-lifting') },
      { title: 'Hoodies', image: B('fall-mens-casual-hoodie-fashion') },
      { title: 'Tanktop', image: B('rope-workout') },
      { title: 'Shorts', image: B('upper-body-work-out') }
    ],
    // صورة "تسوق الإطلالة" لو القسم من غير صورة (نفس منتجات look: الهودي + السويت بانتس)
    lookImage: B('matching-hoodie-and-sweatpants')
  };
})();
