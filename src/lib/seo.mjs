// Schema.org describes visible features. Do not invent review ratings or rich-result eligibility.
export const absoluteToolUrl = (slug, locale = 'en') =>
  'https://pdf.plainmile.com/' + (locale === 'zh' ? 'zh/' : '') + (slug ? slug + '/' : '');

export function websiteJsonLd(locale = 'en') {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'PlainMile PDF Tools',
    url: absoluteToolUrl('', locale),
    description: locale === 'zh'
      ? '免费 PDF 合并、拆分、排序、文字提取与图片转换工具，文件在浏览器中处理。'
      : 'Free browser-local tools to merge, split, organize and convert PDF pages.',
    inLanguage: locale === 'zh' ? 'zh-CN' : 'en',
  };
}
export function toolJsonLd(tool, locale = 'en') {
  const url = absoluteToolUrl(tool.slug, locale);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: locale === 'zh' ? '首页' : 'Home', item: absoluteToolUrl('', locale) },
        { '@type': 'ListItem', position: 2, name: tool.title, item: url },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: tool.title,
      description: tool.description,
      url,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires a modern browser with JavaScript enabled',
      isAccessibleForFree: true,
      inLanguage: locale === 'zh' ? 'zh-CN' : 'en',
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
    },
  ];
}
