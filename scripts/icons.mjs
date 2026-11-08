// PWA-иконки и картинка для соцсетей из SVG (меняйте под бренд и перезапускайте).
import sharp from 'sharp';
import fs from 'node:fs';
const accent = process.env.ICON_ACCENT || '#2F7D6D';
const svg = (pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${pad ? 0 : 116}" fill="${pad ? accent : '#F5F3EE'}"/>
<g transform="translate(256 256) scale(${pad ? 0.78 : 1}) translate(-256 -256)"><circle cx="256" cy="256" r="${pad ? 200 : 196}" fill="${accent}"/>
<circle cx="256" cy="256" r="128" fill="none" stroke="#fff" stroke-width="22" stroke-dasharray="30 34" stroke-linecap="round"/>
<circle cx="214" cy="236" r="20" fill="#fff"/><circle cx="298" cy="236" r="20" fill="#fff"/><path d="M206 290q50 36 100 0" stroke="#fff" stroke-width="22" fill="none" stroke-linecap="round"/></g></svg>`;
fs.mkdirSync('public/icons', { recursive: true });
fs.writeFileSync('public/icons/icon.svg', svg());
await sharp(Buffer.from(svg())).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(Buffer.from(svg())).resize(512, 512).png().toFile('public/icons/icon-512.png');
await sharp(Buffer.from(svg(1))).resize(512, 512).png().toFile('public/icons/icon-maskable.png');
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#F5F3EE"/><g transform="translate(120 155) scale(0.62)">${svg().replace(/<\/?svg[^>]*>/g, '')}</g>
<text x="500" y="300" font-family="DejaVu Sans, sans-serif" font-size="84" font-weight="700" fill="#1B2321">Помпон</text><text x="500" y="370" font-family="DejaVu Sans, sans-serif" font-size="36" fill="#55615D">Химчистка мягкой мебели на дому</text></svg>`;
await sharp(Buffer.from(og)).png().toFile('public/icons/og.png');
console.log('icons ok');
