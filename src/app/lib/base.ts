// Astro's `import.meta.env.BASE_URL` reflects the `base` value from
// astro.config.mjs verbatim ("/Pomofree", no trailing slash here), so
// naively concatenating `${BASE_URL}app/` yields "/Pomofreeapp/". This
// helper normalizes it to always end in "/" so it's safe to concatenate a
// relative path directly onto it anywhere in the app.
export const BASE_URL: string = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
