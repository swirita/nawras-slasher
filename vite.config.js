// One base for builds and preview; local development stays at the domain root.
// Override VITE_BASE_PATH when deploying to a different repository or a custom domain.
export default ({ command, isPreview }) => ({
  base: process.env.VITE_BASE_PATH || (command === 'build' || isPreview ? '/nawras-slasher/' : '/'),
})
