import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Dark padding instead of the preset's white, so the iOS home screen icon has no white border.
const background = '#0b0b0c';

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background } },
  },
  images: ['public/icon.svg'],
});
