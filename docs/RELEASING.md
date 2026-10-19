# Releasing to npm

Maintainer-only notes. User-facing install steps live in `README.md`.

## Normal publish

```sh
npm login
npm run check
npm test
npm publish
```

`prepublishOnly` runs `npm run check && npm test` automatically.

For a scoped package, change `package.json` `name` to `@your-scope/ftb-quests-preview`, then:

```sh
npm publish --access public
```

## Staged publishing / 2FA

If the account uses npm staged publishing, `npm publish` may create a `0.0.0-stage` placeholder and require approval before the real version becomes installable.

Use npm 12+ (the bundled npm may not expose `npm stage`):

```sh
npx -y npm@latest stage list
npx -y npm@latest stage approve <stage-id>
```

Approval requires 2FA. Check availability with:

```sh
npm view ftb-quests-preview version
```

A staged version can stay in automated review for a while; do not republish the same version. Wait for review or approve the stage.

## Versioning

- Do not reuse a version that exists as staged or published.
- Update `CHANGELOG.md` if one is added.
- Keep `files` limited to runtime assets, skill, README, and license; tests/docs stay out of the tarball.
