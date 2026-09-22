const cheerio = require("cheerio");

const RULES = [
  {
    name: "Header",
    type: "header",
    selectors: [
      ["header", 0.99],
      ['[role="banner"]', 0.96],
      ['[class*="site-header"], [id*="header"]', 0.86],
    ],
  },
  {
    name: "Navbar",
    type: "navbar",
    selectors: [
      ["nav", 0.99],
      ['[role="navigation"]', 0.97],
      ['[class*="navbar"], [class*="main-menu"]', 0.88],
    ],
  },
  {
    name: "Hero",
    type: "hero",
    selectors: [
      ['[class~="hero"], [id~="hero"]', 0.96],
      ['[class*="hero-"], [class*="-hero"], [class*="jumbotron"]', 0.9],
      ['[class*="banner"]', 0.76],
    ],
  },
  {
    name: "Slider",
    type: "slider",
    selectors: [
      [".swiper, .splide, .slick-slider", 0.98],
      ['[class*="carousel"], [class*="slider"]', 0.91],
      ['[data-slider], [aria-roledescription="carousel"]', 0.94],
    ],
  },
  {
    name: "Cards",
    type: "cards",
    selectors: [
      ['[class~="card"], [class*="-card"], [class*="card-"]', 0.91],
      ["main article", 0.72],
    ],
  },
  {
    name: "Gallery",
    type: "gallery",
    selectors: [
      ['[class*="gallery"], [id*="gallery"]', 0.94],
      ['[data-gallery], [class*="lightbox"]', 0.88],
    ],
  },
  {
    name: "FAQ",
    type: "faq",
    selectors: [
      ['[class*="faq"], [id*="faq"]', 0.96],
      ["details", 0.8],
      ['[itemtype*="FAQPage"]', 0.99],
    ],
  },
  {
    name: "Contact Form",
    type: "contact-form",
    selectors: [
      ['form[action*="contact"], form[class*="contact"]', 0.96],
      ['form input[type="email"]', 0.86],
      ["form textarea", 0.76],
    ],
  },
  {
    name: "Footer",
    type: "footer",
    selectors: [
      ["footer", 0.99],
      ['[role="contentinfo"]', 0.97],
      ['[class*="site-footer"], [id*="footer"]', 0.88],
    ],
  },
  {
    name: "Testimonials",
    type: "testimonials",
    selectors: [
      ['[class*="testimonial"], [id*="testimonial"]', 0.96],
      ['[class*="review-card"], blockquote[cite]', 0.76],
    ],
  },
  {
    name: "Blog Cards",
    type: "blog-cards",
    selectors: [
      ['[class*="post-card"], [class*="blog-card"]', 0.96],
      ['article[class*="post"], [class*="blog-grid"] article', 0.86],
    ],
  },
  {
    name: "Product Grid",
    type: "product-grid",
    selectors: [
      ['[class*="product-grid"], [class*="products-grid"]', 0.97],
      [".woocommerce ul.products, .products .product", 0.94],
      ['[class*="product-card"]', 0.88],
    ],
  },
  {
    name: "Pricing",
    type: "pricing",
    selectors: [
      ['[class*="pricing"], [id*="pricing"]', 0.96],
      ['[class*="price-card"], [class*="plan-card"]', 0.87],
    ],
  },
  {
    name: "Breadcrumb",
    type: "breadcrumb",
    selectors: [
      ['nav[aria-label*="breadcrumb" i], [class*="breadcrumb"]', 0.98],
      ['[itemtype*="BreadcrumbList"]', 0.99],
    ],
  },
  {
    name: "Sidebar",
    type: "sidebar",
    selectors: [
      ['aside, [role="complementary"]', 0.92],
      ['[class~="sidebar"], [id*="sidebar"]', 0.9],
    ],
  },
  {
    name: "Modal",
    type: "modal",
    selectors: [
      ['[class*="modal"], [role="dialog"]', 0.97],
      ['[data-modal], [aria-modal="true"]', 0.96],
    ],
  },
  {
    name: "Accordion",
    type: "accordion",
    selectors: [
      ["details", 0.95],
      ['[class*="accordion"], [data-accordion]', 0.96],
    ],
  },
  {
    name: "Tabs",
    type: "tabs",
    selectors: [
      ['[role="tablist"], [role="tab"]', 0.98],
      ['[class*="tabs"], [data-tabs]', 0.96],
    ],
  },
];

function detectComponents(html) {
  const $ = cheerio.load(html, { decodeEntities: false });

  return RULES.map((rule) => {
    let confidence = 0;
    const matchedElements = new Set();

    for (const [selector, score] of rule.selectors) {
      try {
        $(selector).each((_, element) => matchedElements.add(element));
        if ($(selector).length) confidence = Math.max(confidence, score);
      } catch {
        // Ignore selector support differences across parser versions.
      }
    }

    if (!matchedElements.size) return null;
    if (matchedElements.size >= 3) confidence = Math.min(0.99, confidence + 0.02);

    return {
      name: rule.name,
      type: rule.type,
      confidence: Math.round(confidence * 100),
      count: matchedElements.size,
    };
  }).filter(Boolean);
}

module.exports = { detectComponents };
