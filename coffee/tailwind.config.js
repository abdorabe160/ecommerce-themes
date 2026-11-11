/** DECAFE — Tailwind build config. Output: assets/decafe.css (run `npm run build:css`). */
// Colors are CSS variables (hex, set from theme settings); opacity modifiers resolve through color-mix.
const mix = (v) => ({ opacityValue }) =>
  opacityValue === undefined ? `var(${v})`
    : /^var\(/.test(opacityValue) ? `color-mix(in srgb, var(${v}) calc(${opacityValue} * 100%), transparent)`
    : `color-mix(in srgb, var(${v}) ${opacityValue * 100}%, transparent)`;

module.exports = {
  content: ['./layouts/**/*.njk', './widgets/**/*.njk', './ui/**/*.njk', './assets/main.js'],
  corePlugins: { container: false },
  theme: {
    extend: {
      colors: {
        ink: mix('--c-ink'),
        espresso: mix('--c-espresso'),
        coffee: mix('--c-coffee'),
        caramel: mix('--c-caramel'),
        cream: mix('--c-cream'),
        beige: mix('--c-beige'),
        muted: mix('--c-muted'),
        'muted-ink': mix('--c-muted-ink'),
        sale: mix('--c-sale'),
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        brand: ['var(--font-brand)'],
      },
      borderRadius: {
        card: 'var(--radius-card)',
        media: 'var(--radius-media)',
      },
      maxWidth: {
        shell: 'var(--shell-max)',
        prose: '68ch',
      },
      transitionTimingFunction: {
        calm: 'cubic-bezier(.22,.61,.36,1)',
      },
      aspectRatio: {
        card: '5 / 4',
        portrait: '3 / 4',
      },
    },
  },
  plugins: [],
};
