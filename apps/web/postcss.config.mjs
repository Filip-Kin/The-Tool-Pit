/** @type {import('postcss').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    // Tailwind's own compiler stamps every build with a preserved license
    // comment (`/*! tailwindcss v4.x | MIT License | ... */`), which even
    // Next's built-in CSS minifier leaves alone by default since bang-comments
    // are meant to survive minification. cssnano's discardComments with
    // removeAll strips it anyway (the license lives in the published package,
    // not in every response); production only, so local dev rebuilds don't
    // pay for an extra minify pass.
    ...(process.env.NODE_ENV === 'production' ? { cssnano: { preset: ['default', { discardComments: { removeAll: true } }] } } : {}),
  },
}

export default config
