<!-- swelte:deploy -->

```sh
npm run build        # swelte build → linux/amd64 from package.json
vercel deploy            # preview URL
vercel deploy --prod     # production
```

Vercel builds `Dockerfile.vercel` in the cloud from the uploaded local `dist/`
output — no toolchain in the cloud. Dashboard → project → Settings: Root Directory `examples/docs-site`, Dockerfile Path `Dockerfile.vercel`.

<!-- /swelte:deploy -->
