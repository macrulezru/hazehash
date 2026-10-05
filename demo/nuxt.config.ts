export default defineNuxtConfig({
  modules: ['hazehash-nuxt'],
  compatibilityDate: '2024-09-01',
  devtools: { enabled: false },
  telemetry: false,
  app: {
    head: {
      title: 'HazeHash demo',
      meta: [
        {
          name: 'description',
          content: 'Original images next to their 28-byte HazeHash placeholders',
        },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
  hazehash: {
    // Every image in public/images gets a hash at build time; <PlaceholderImage> looks it up by src.
    dirs: [{ dir: 'public/images', prefix: '/images' }],
    budget: 28,
  },
});
