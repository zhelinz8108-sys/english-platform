# Database security checks

Run against an already migrated PostgreSQL database:

```powershell
$env:DATABASE_ADMIN_URL = 'postgresql://english_owner:english_owner@localhost:55432/english_platform'
pnpm --filter @english/database test:security
```

The test creates two tenants and their minimum dependent records inside one transaction, switches to
the real runtime roles, executes the security assertions, and always rolls the transaction back. It
does not reset the database or modify the demo seed.
