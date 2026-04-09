# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Overview

NestJS + MongoDB REST API server for the **Estate Ledger** mobile app — a rental property management system. Handles properties, tenants, contracts, payments, and reporting.

## Commands

```bash
# Install dependencies
npm install

# Development (watch mode)
npm run start:dev

# Production build
npm run build
npm run start:prod

# Run tests
npm run test          # unit tests
npm run test:e2e      # end-to-end tests
npm run test:cov      # coverage report

# Lint
npm run lint
```

## Architecture

NestJS standard monolith with feature modules. No microservices yet.

```
src/
  auth/               ← JWT authentication (login endpoint, guards)
  users/              ← User accounts (landlord accounts)
  properties/         ← Property CRUD
  tenants/            ← Tenant CRUD
  contracts/          ← Contract CRUD + status auto-update
  payments/           ← Payment records + collect-payment action
  reports/            ← Aggregation queries (YTD, monthly, breakdown)
  common/
    decorators/       ← @CurrentUser(), @Roles()
    filters/          ← Global exception filter
    guards/           ← JwtAuthGuard, RolesGuard
    interceptors/     ← Response transform interceptor
    pipes/            ← Validation pipe config
  app.module.ts
  main.ts
```

### Module Dependencies

```
AppModule
  ├── MongooseModule 'primary' (Atlas cluster — reads + writes)
  ├── MongooseModule 'backup'  (Atlas cluster — writes only)
  ├── ConfigModule (global .env)
  ├── AuthModule
  │     └── UsersModule
  ├── PropertiesModule
  ├── TenantsModule             (also imports Contract model on 'primary' for deletion guard)
  ├── ContractsModule
  │     └── PaymentsModule (generates payment schedule on contract create)
  ├── PaymentsModule
  └── ReportsModule
        └── PaymentsModule (primary connection only)
```

---

## Database Schema (MongoDB / Mongoose)

### Collection: `users`

```ts
{
  _id:       ObjectId
  email:     string   // unique, required — login credential
  password:  string   // bcrypt hash
  name:      string   // display name
  createdAt: Date
  updatedAt: Date
}
```

### Collection: `properties`

```ts
{
  _id:       ObjectId
  name:      string   // required — e.g. "The Meridian Penthouse"
  address:   string   // required — e.g. "12 Skyline Ave, Floor 32"
  area:      number   // in m²
  status:    enum     // 'rented' | 'available' | 'overdue'
  isDeleted: boolean  // soft-delete flag, default false
  createdAt: Date
  updatedAt: Date
}
```

> `status` is derived from the active contract + latest payment, but stored as a cached field
> and updated by a scheduled job whenever a payment changes.
> Soft-deleted properties are excluded from all reads. DELETE is a soft delete.

### Collection: `tenants`

```ts
{
  _id:              ObjectId
  fullName:         string   // required — legal full name
  email:            string   // required, unique
  phone:            string   // e.g. "01xxxxxxxxx"
  identificationId: string   // national ID / passport number
  isDeleted:        boolean  // soft-delete flag, default false
  createdAt:        Date
  updatedAt:        Date
}
```

> Tenants are standalone. The property link lives on the Contract (not the Tenant).
> Soft-deleted tenants are excluded from all reads. DELETE is a soft delete.
> Cannot delete a tenant that has an active contract (`isEarlyTerminated !== true && endDate > now`).

### Collection: `contracts`

```ts
{
  _id:             ObjectId
  tenantId:        ObjectId  // ref: Tenant, required — populated on all reads
  propertyId:      ObjectId  // ref: Property, required — populated on all reads
  rent:            number    // monthly rent amount
  paymentInterval: enum      // 'Monthly' | 'Quarterly' | 'Semi-Annually' | 'Annually'
  securityDeposit: number
  annualIncrease:  number    // percentage, e.g. 5 = 5%
  startDate:       Date
  endDate:         Date
  status:          enum      // 'active' | 'expiring' | 'expired' | 'terminated'
  isEarlyTerminated: Boolean
  createdAt:       Date
  updatedAt:       Date
}
```

> `status` rules (auto-computed on read + cached):
> - `terminated` — isEarlyTerminated is true
> - `expired`    — endDate < today
> - `expiring`   — endDate is within 60 days from today
> - `active`     — everything else
>
> `tenantId` and `propertyId` are populated (full objects) on all service responses.

### Collection: `payments`

```ts
{
  _id:        ObjectId
  contractId: ObjectId  // ref: Contract, required
  propertyId: ObjectId  // ref: Property, required (denormalized for query speed) — populated on all reads
  tenantId:   ObjectId  // ref: Tenant, required (denormalized for query speed) — populated on all reads
  month:      Date      // first day of the payment period (e.g. 2026-04-01)
  amount:     number    // actual amount due (accounts for annual increase)
  dueDate:    Date      // when payment is due
  paidDate:   Date | null  // null if not yet paid — source of truth for paid status
  isVoided:   boolean   // true if contract was early-terminated before this payment's dueDate
  createdAt:  Date
  updatedAt:  Date
}
```

> There is **no stored `status` field** on payments. Status is derived on the client from:
> - `paid`     — `paidDate !== null`
> - `overdue`  — `paidDate === null && isVoided === false && dueDate < now`
> - `upcoming` — `paidDate === null && isVoided === false && dueDate >= now`
> - `voided`   — `isVoided === true`
>
> The API `?status=` query parameter is still supported — the service translates it to
> source-of-truth field filters before querying MongoDB.

**Payment schedule generation:** When a contract is created, the server generates all
payment records for the contract's full duration immediately. For a 12-month monthly contract,
that creates 12 payment documents at once.

### Indexes

```ts
// properties
{ status: 1 }
{ isDeleted: 1 }

// tenants
{ email: 1 }         // unique
{ isDeleted: 1 }

// contracts
{ tenantId: 1 }
{ propertyId: 1 }
{ status: 1 }
{ endDate: 1 }       // for expiry queries

// payments
{ contractId: 1 }
{ dueDate: 1 }
{ propertyId: 1, month: 1 }
{ tenantId: 1, dueDate: 1 }
```

---

## REST API Endpoints

Base URL: `/api/v1`

All endpoints (except `POST /auth/login`) require `Authorization: Bearer <jwt>`.

### Auth

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/auth/login` | `{ email, password }` | Returns `{ accessToken, user }` — **Public** |
| `POST` | `/auth/signup` | `{ email, password, name }` | Register a new user — **Public** |
| `GET` | `/auth/me` | — | Returns current user profile |

### Properties

| Method | Path | Body / Params | Description |
|---|---|---|---|
| `GET` | `/properties` | — | List all non-deleted properties (with computed status) |
| `GET` | `/properties/:id` | — | Single property + current tenant info |
| `POST` | `/properties` | `{ name, address, area? }` | Create property |
| `PATCH` | `/properties/:id` | Partial fields | Update property |
| `DELETE` | `/properties/:id` | — | Soft-delete property (only if no active contracts — status not `rented` or `overdue`) |

**GET /properties/:id** response includes a `currentTenant` virtual populated from the
active contract for that property (if any).

### Tenants

| Method | Path | Body / Params | Description |
|---|---|---|---|
| `GET` | `/tenants` | — | List all non-deleted tenants with current property + payment status |
| `GET` | `/tenants/:id` | — | Single tenant + associated contracts |
| `POST` | `/tenants` | `{ fullName, email, phone, identificationId }` | Create tenant |
| `PATCH` | `/tenants/:id` | Partial fields | Update tenant |
| `DELETE` | `/tenants/:id` | — | Soft-delete tenant (only if no active contracts) |

### Contracts

| Method | Path | Body / Params | Description |
|---|---|---|---|
| `GET` | `/contracts` | `?status=active\|expiring\|expired` | List contracts (optional status filter). Returns populated tenantId/propertyId. |
| `GET` | `/contracts/:id` | — | Single contract + payments summary. Returns populated tenantId/propertyId. |
| `POST` | `/contracts` | `{ tenantId, propertyId, rent, paymentInterval, securityDeposit, annualIncrease, startDate, endDate }` | Create contract + generate payment schedule. Returns populated tenantId/propertyId. |
| `PATCH` | `/contracts/:id` | Partial fields (dates/rent only) | Update contract metadata. Returns populated tenantId/propertyId. |
| `PATCH` | `/contracts/:id/terminate` | `{ terminationDate? }` | Early-terminate an active contract. Returns populated tenantId/propertyId. |

**POST /contracts** side-effects:
1. Creates all payment documents for the full contract duration
2. Updates the linked property's `status` to `'rented'`

**PATCH /contracts/:id/terminate** side-effects:
1. Sets `isEarlyTerminated = true`, `status = 'terminated'`
2. Sets `endDate` to `terminationDate` (defaults to today if omitted)
3. Sets `isVoided = true` on all future payment records where `dueDate > terminationDate` and `paidDate = null`
4. Updates the linked property's `status` back to `'available'`
5. Returns `400` if contract is already `'terminated'` or `'expired'`

### Payments

| Method | Path | Body / Params | Description |
|---|---|---|---|
| `GET` | `/payments` | `?contractId=&status=` | List payments (filter by contract or status). Returns populated tenantId/propertyId. |
| `GET` | `/payments/:id` | — | Single payment. Returns populated tenantId/propertyId. |
| `PATCH` | `/payments/:id/collect` | `{ paidDate? }` | Mark payment as paid (defaults paidDate to today). Returns populated tenantId/propertyId. |

**PATCH /payments/:id/collect** side-effects:
1. Sets `paidDate` to the provided date (or today)
2. Recalculates the property's cached `status` (may change from `'overdue'` to `'rented'`)

### Reports

| Method | Path | Query | Description |
|---|---|---|---|
| `GET` | `/reports/summary` | `?year=2026` | YTD revenue, collected, pending, overdue totals |
| `GET` | `/reports/monthly` | `?months=6` | Monthly collection totals for the last N months |
| `GET` | `/reports/breakdown` | — | Current-month payment status breakdown (counts + amounts) |

**GET /reports/summary** response shape:
```json
{
  "ytdRevenue": 95650,
  "collected": 14200,
  "pending": 2850,
  "overdue": 1400,
  "collectedPercent": 77
}
```

**GET /reports/monthly** response shape:
```json
{
  "data": [
    { "month": "Jan", "amount": 14200 },
    { "month": "Feb", "amount": 16800 }
  ]
}
```

---

## Key Patterns

### DTOs & Validation

Use `class-validator` + `class-transformer` on every DTO. Enable `ValidationPipe` globally in `main.ts` with `whitelist: true, forbidNonWhitelisted: true`.

```ts
// main.ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
app.setGlobalPrefix('api/v1');
```

### Response Shape

Wrap all responses in a consistent envelope via a `TransformInterceptor`:

```json
{ "data": { ... }, "statusCode": 200 }
```

Error responses use NestJS's built-in `HttpException` classes (no custom wrapper needed for errors — the global exception filter handles them).

### Soft Deletion

Properties and tenants use soft deletion — `DELETE` endpoints set `isDeleted = true` rather than removing the document. All `find` queries filter `{ isDeleted: { $ne: true } }`. Hard deletion is not used anywhere.

Guard rules enforced before soft-deleting:
- **Property** — blocked if `status === 'rented' || 'overdue'` (active contract exists)
- **Tenant** — blocked if any contract exists where `isEarlyTerminated !== true && endDate > now`

### Contract Status Computation

Contract `status` is computed on every read, not stored — derive it in the service layer
based on `endDate` vs today and `isEarlyTerminated`. Values: `'terminated'`, `'expired'`, `'expiring'` (≤ 60 days), `'active'`.

### Payment Status — Derived, Not Stored

There is **no `status` field** on payment documents. Status is derived from source-of-truth fields:

```ts
// Client-side derivation logic:
if (isVoided)                                 → 'voided'
if (paidDate !== null)                        → 'paid'
if (paidDate === null && dueDate < now)       → 'overdue'
if (paidDate === null && dueDate >= now)      → 'upcoming'
```

The `?status=` query parameter on `GET /payments` is still accepted — the service translates it to the equivalent `paidDate`/`dueDate`/`isVoided` MongoDB filter before querying.

### Dual-Database Strategy

Two named Mongoose connections: `'primary'` (Atlas cluster A) and `'backup'` (Atlas cluster B).

**Rule:** GET endpoints read from `primary` only. All writes (POST/PATCH/DELETE) mirror to both.

Each write-capable service injects both models and uses a `dualWrite` helper:

```ts
// Registered in module:
MongooseModule.forFeature([{ name: X.name, schema: XSchema }], 'primary'),
MongooseModule.forFeature([{ name: X.name, schema: XSchema }], 'backup'),

// Injected in service:
@InjectModel(X.name, 'primary') private primaryModel: Model<XDocument>
@InjectModel(X.name, 'backup')  private backupModel:  Model<XDocument>

// Write pattern:
private async dualWrite<T>(primaryOp: () => Promise<T>, backupOp: () => Promise<unknown>): Promise<T> {
  const [primaryResult, backupResult] = await Promise.allSettled([primaryOp(), backupOp()]);
  if (backupResult.status === 'rejected') console.error('[Backup DB] write failed:', backupResult.reason);
  if (primaryResult.status === 'rejected') throw primaryResult.reason;
  return primaryResult.value;
}
```

- **Primary failure** → throws (operation fails for the caller).
- **Backup failure** → logged to console, swallowed (caller gets primary result).
- **Bulk ops** (`insertMany`, `updateMany`) use `Promise.allSettled` inline.
- **All `create()` methods** pre-generate `_id = new Types.ObjectId()` so both clusters store the same ObjectId. This applies to Properties, Tenants, Contracts, and Payments.
- **`ReportsModule`** registers only on `'primary'` (read-only, no backup model needed).
- **Cascading writes** (e.g. `ContractsService` calling `PaymentsService.generateSchedule`) do not double-write — each service handles its own dual-write internally.

### Authentication

- **Strategy:** JWT (access token only — no refresh token for v1)
- **Library:** `@nestjs/jwt` + `passport-jwt`
- **Token expiry:** 7 days
- **Guard:** Apply `JwtAuthGuard` globally in `AppModule`; use `@Public()` decorator on `POST /auth/login`

### Security Middleware

- **Helmet** — sets security HTTP headers (X-Frame-Options, HSTS, Content-Security-Policy, etc.). Applied in `main.ts` via `app.use(helmet())`.
- **Rate Limiting** — `@nestjs/throttler` with a global limit of 60 requests/min. Registered as a global guard in `AppModule`. Login endpoint has a stricter limit of 5 requests/min via `@Throttle()`.
- **CORS** — configured via `CORS_ORIGIN` env var (comma-separated origins). Falls back to `'*'` when unset (local dev).

---

## Deployment (Render)

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm run start:prod`
- **Environment Variables:** Set all vars from `.env.example` in the Render dashboard. Use a strong random `JWT_SECRET` in production. Set `CORS_ORIGIN` to the mobile app's origin. `PORT` is auto-assigned by Render — do not set it.
- **Node Version:** `>=18.0.0` (declared in `package.json` `engines`)

---

## Environment Variables (`.env`)

```
# MongoDB — two Atlas clusters
MONGODB_URI_PRIMARY=mongodb+srv://<user>:<password>@primary-cluster.mongodb.net/estate-ledger
MONGODB_URI_BACKUP=mongodb+srv://<user>:<password>@backup-cluster.mongodb.net/estate-ledger

# JWT
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=7d

# App
PORT=3000
NODE_ENV=development

# CORS — comma-separated allowed origins (omit for wildcard '*')
# CORS_ORIGIN=https://myapp.com
```

Use `@nestjs/config` with `ConfigModule.forRoot({ isGlobal: true })`.

---

## Key Dependencies

| Package | Purpose |
|---|---|
| `@nestjs/core`, `@nestjs/common` | NestJS framework |
| `@nestjs/mongoose` | Mongoose ODM integration |
| `mongoose` | MongoDB ODM |
| `@nestjs/jwt` | JWT module |
| `@nestjs/passport` + `passport-jwt` | JWT authentication strategy |
| `bcrypt` | Password hashing |
| `class-validator` + `class-transformer` | DTO validation + transformation |
| `@nestjs/config` | `.env` loading via `ConfigModule` |
| `@nestjs/schedule` | Cron jobs (property overdue status sync) |

---

## Scheduled Jobs

A nightly cron job (`@Cron('0 0 * * *')`) runs in `PaymentsModule` to keep property `status` accurate:

1. Finds all properties that have unpaid, non-voided payments with `dueDate < now` → sets those properties' `status` to `'overdue'`
2. Finds properties that have paid, non-voided payments but are not in the overdue set → resets their `status` to `'rented'`

There is no batch update of payment fields — payment status is always derived on read from `paidDate`, `dueDate`, and `isVoided`.
