// Verified routes from plainmile/image-tools. Keep these as real, separate
// browser-local tools, not duplicate PDF landing pages or cross-site transfers.
export const IMAGE_TOOLS_ORIGIN = 'https://image.plainmile.com';

const tools = Object.freeze({
  'resize-image': {
    en: { title: 'Resize an image', description: 'Set exact image width and height in pixels, with fit or crop.' },
    zh: { title: '修改图片尺寸', description: '指定图片宽高像素，选择留白保留或裁剪填充。' },
  },
  'compress-image-to-size': {
    en: { title: 'Compress an image to KB', description: 'Try a target maximum KB size for JPEG or WebP output.' },
    zh: { title: '将图片压缩到指定 KB', description: '尝试让 JPEG 或 WebP 输出符合目标文件大小上限。' },
  },
  'bulk-image-resizer': {
    en: { title: 'Batch resize images', description: 'Resize multiple JPG, PNG or WebP images and save a ZIP.' },
    zh: { title: '批量调整图片尺寸', description: '批量调整 JPG、PNG 或 WebP 图片尺寸并下载 ZIP。' },
  },
});

export const imageCompanionContexts = Object.freeze({
  home: ['resize-image', 'compress-image-to-size', 'bulk-image-resizer'],
  'image-to-pdf': ['resize-image', 'compress-image-to-size'],
  'pdf-to-images': ['resize-image', 'bulk-image-resizer', 'compress-image-to-size'],
});

export function imageToolsHome(locale = 'en') {
  return IMAGE_TOOLS_ORIGIN + (locale === 'zh' ? '/zh/' : '/');
}

export function companionImageTools(context = 'home', locale = 'en') {
  if (!Object.hasOwn(imageCompanionContexts, context)) throw new Error('Unknown image tool context.');
  if (!['en', 'zh'].includes(locale)) throw new Error('Unknown locale.');
  return imageCompanionContexts[context].map(slug => ({
    slug, ...tools[slug][locale],
    href: IMAGE_TOOLS_ORIGIN + (locale === 'zh' ? '/zh/' : '/') + slug + '/',
  }));
}
