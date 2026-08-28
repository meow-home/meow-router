# Build & Release

## Tooling

Recommended:

- Electron
- Electron Builder
- TypeScript
- React
- Vite
- SQLite
- Drizzle ORM
- keytar or an equivalent OS secure credential mechanism

## Development

```bash
npm install
npm run dev
```

## Validation

```bash
npm run typecheck
npm run lint
npm test
```

## Production build

```bash
npm run build
npm run package
```

## Platform targets

### Windows

Produce `.exe` installer.

### macOS

Produce `.dmg`.

### Linux

Produce AppImage and/or `.deb`.

## Release checklist

- version updated;
- migrations tested from previous version;
- clean install tested;
- upgrade tested;
- provider credentials preserved;
- gateway starts/stops correctly;
- no debug logs;
- no secrets in packaged files;
- API compatibility smoke test passed.
