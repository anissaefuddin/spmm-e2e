# Dewan Masyayikh — Codebase Analysis

> Last updated: 2026-04-12
> Scope: Full feature audit of the "Dewan Masyayikh" (DM) module across backend and frontend.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (spmm-cms)                     │
│  React 18 + TypeScript + Vite + TanStack Query + Styled Comp.  │
├─────────────────────────────────────────────────────────────────┤
│  /app/lembaga-dm              → LembagaDmScreen (list)          │
│  /app/lembaga-dm/detail/:id   → ProfileScreen (detail)          │
│  Modal: ModalDetailPesantren  → EMIS data + sync trigger        │
├─────────────────────────────────────────────────────────────────┤
│                         BACKEND (spmm-be)                       │
│  Spring Boot 3.3.2 + JPA + PostgreSQL + @Async thread pool     │
├─────────────────────────────────────────────────────────────────┤
│  GET  /api/dewan-masyayikh         → DM list (lembagas+users)   │
│  GET  /api/dewan-masyayikh/:id     → DM detail (all joins)      │
│  POST /api/sync-emis/:id           → EMIS fetch + background DB │
│  GET  /api/lembaga/dm              → LEGACY (still exists)      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Source Rules (STRICT)

| Data | Source Table | Key Field |
|------|-------------|-----------|
| Institution name | `lembagas.name` | `institution_id` |
| NSPP | `lembagas.nspp` | `institution_id` |
| Address | `lembagas.address` | `institution_id` |
| Institution status | `lembagas.status` | `institution_id` |
| User fullname | `users.fullname` | `users.institution_id` |
| Email | `users.email` | `users.institution_id` |
| Certificate (SK) | `users.certificate_url` | `users.institution_id` |
| Structure count | `COUNT(user_structure)` | `user_structure.user_id` |
| Grouping | `lembaga_group` | `lembaga_group.institution_id` |
| EMIS data | External EMIS API | `lembagas.nspp` + `type_lembaga` |

**DO NOT USE** for display:
- ❌ `users.lembaga`
- ❌ `users.nomor_statistik`
- ❌ `users.address`

---

## 3. Affected Files — Complete Inventory

### 3.1 Backend — New Files

| File | Purpose |
|------|---------|
| `controller/DewanMasyayikhController.java` | `GET /api/dewan-masyayikh` + `GET /:id` |
| `controller/EmisSyncController.java` | `POST /api/sync-emis/:id` |
| `service/DewanMasyayikhService.java` | List + detail aggregation logic |
| `service/EmisSyncService.java` | EMIS fetch + `@Async` background DB sync |
| `dto/DewanMasyayikhListResponse.java` | List DTO (includes `structure_count`) |
| `dto/DewanMasyayikhDetailResponse.java` | Detail DTO (lembaga + dewan + structures + grouped) |
| `dto/EmisSyncResponse.java` | Sync response DTO |

### 3.2 Backend — Unchanged (but relevant)

| File | Relevance |
|------|-----------|
| `service/GetDetaillembagaService.java` | EMIS API client (reused by EmisSyncService) |
| `config/AsyncConfig.java` | Thread pool config (`@EnableAsync`, 15 core / 30 max) |
| `repository/LembagasRepository.java` | `findByInstitutionId`, `findByFiltersWithGroupIds` |
| `repository/UsersRepository.java` | `findFirstByInstitutionId` |
| `repository/UserStructureRepository.java` | `findByUserId` |
| `repository/LembagaGroupRepository.java` | `findDistinctGroupIds`, `findByGroupId` |

### 3.3 Frontend — New Files

| File | Purpose |
|------|---------|
| `services/api/dewanMasyayikhServices.ts` | `getDmList`, `getDmDetail`, `syncEmis` |
| `services/types/dewanMasyayikhTypes.ts` | All DM type definitions |
| `modules/lembaga-dm/detail/useDmDetail.ts` | Detail page data hook |
| `modules/lembaga-dm/detail/components/.../LembagaInfoSection.tsx` | Section 1: Institution info |
| `modules/lembaga-dm/detail/components/.../DewanInfoSection.tsx` | Section 2: User info + badges |
| `modules/lembaga-dm/detail/components/.../StrukturSection.tsx` | Section 3: Structure members |
| `modules/lembaga-dm/detail/components/.../SatuanPendidikanSection.tsx` | Section 4: Grouped lembagas |
| `modules/lembaga-dm/detail/components/.../ModalDetailPesantren.styles.ts` | Modal styled-components |

### 3.4 Frontend — Modified Files

| File | Changes |
|------|---------|
| `modules/lembaga-dm/useLembagaDm.tsx` | New API, columns (no Status/StatusAkun, added Struktur/SK), client-side filters |
| `modules/lembaga-dm/LembagaDmScreen.tsx` | Removed label, updated placeholder, SK+Struktur dropdowns |
| `modules/lembaga-dm/detail/ProfileScreen.tsx` | Rewritten: 4 sections + loading/empty states |
| `modules/lembaga-dm/detail/components/.../useModalDetailPesantren.tsx` | useQuery cache + `syncEmis` mutation + toast + cache invalidation |
| `modules/lembaga-dm/detail/components/.../ModalDetailPesantren.tsx` | Full redesign: sections, data source badge, diff table, stats |

---

## 4. Current Table Columns (List Page)

| # | Column Header | Data Source | Cell Rendering |
|---|---------------|-------------|----------------|
| 1 | NSPP | `lembagas.nspp` | Plain text |
| 2 | Nama Pondok Pesantren | `lembagas.name` | Ellipsis + tooltip |
| 3 | Email | `users.email` | Ellipsis + tooltip, or italic "Tidak tersedia" |
| 4 | Struktur | `COUNT(user_structure)` | Green "Lengkap" (>=2) or Yellow "Belum diisi" |
| 5 | Surat Keputusan | `users.certificate_url` | Green "Lengkap" or Yellow "Belum ada SK" |

**Removed columns**: Status (`lembagas.status`), Status Akun (`users.status`), Perlu Tindakan

---

## 5. Current Filters (List Page)

| Filter | Type | Options | Implementation |
|--------|------|---------|---------------|
| Search | Text input | Free text | Server-side via `?search=` param |
| Surat Keputusan | Dropdown | Semua / Lengkap / Belum Lengkap | Client-side filter on `has_certificate` |
| Struktur | Dropdown | Semua / Sudah Ada / Belum Ada | Client-side filter on `structure_count >= 2` |

---

## 6. EMIS Sync Flow

```
User clicks "Refresh dari EMIS" in modal
    │
    ▼
Frontend: POST /api/sync-emis/{institution_id}
    │
    ├── Backend: EmisSyncController
    │     │
    │     ├── 1. Look up lembagas row → get nspp + type_lembaga
    │     ├── 2. Call EMIS API synchronously (GetDetaillembagaService)
    │     ├── 3. Return EMIS data immediately → 200 OK to frontend
    │     └── 4. Fire @Async: EmisSyncService.syncInBackground()
    │           │
    │           ├── syncLembagaFromEmis(): update name, address, npsn (if changed)
    │           ├── recalculateStatus(): set status=1 if certificate + structure>=2
    │           └── Log: institution_id, changed fields, old→new values
    │
    ▼
Frontend: receives EMIS data → updates modal display
    ├── Invalidates dm-detail cache
    ├── Invalidates list-dewan-masyayikh cache
    └── Shows toast "Data EMIS berhasil disinkronkan ke database"
```

---

## 7. Status Auto-Calculation Logic

```
IF   users.certificate_url IS NOT NULL
AND  COUNT(user_structure WHERE user_id = users.user_id) >= 2

THEN lembagas.status = 1  (aktif)
ELSE lembagas.status = 0  (non aktif)
```

Runs in two places:
1. **DewanMasyayikhService.getDmList()** — sets `has_full_structure` per row on list fetch
2. **EmisSyncService.recalculateStatus()** — updates `lembagas.status` in DB during background sync

---

## 8. Remaining Technical Debt

### 8.1 Incorrect Data Mapping (CRITICAL — Out of Scope)

These existing endpoints still read institution data from `users` instead of `lembagas`:

| File | Lines | Issue |
|------|-------|-------|
| `GetDetailUserService.java` | 66-67, 125-126 | `user.getNomorStatistik()`, `user.getLembaga()` |
| `UserService.java` | 71-72, 172-173, 199-200 | Same pattern across list/detail/create |
| `useLogin.ts` | 33-34 | Cookie stores `lembaga` and `nomor_statistik` from user endpoint |

**Impact**: The self-service profile page and user-management module still show data from `users.lembaga`. The new DM endpoints are correct; the old profile endpoints are not.

### 8.2 Dead Code (Low Priority)

Old components in `modules/lembaga-dm/detail/components/Tabs/` that are no longer imported:
- `LembagaTab/LembagaTab.tsx` + `useLembagaTab.ts`
- `PondokPesantrenTab/PondokPesantrenTab.tsx` + `usePondokPesanterTab.tsx`

These are superseded by the new section components but were not deleted to avoid breaking the profile module which has identical copies.

### 8.3 Legacy Endpoint

`GET /api/lembaga/dm` in `LembagaController.java` is no longer called by the DM frontend (replaced by `/api/dewan-masyayikh`). Keep for deprecation period; add `@Deprecated` annotation.

### 8.4 Client-Side Filtering Limitation

The Surat Keputusan and Struktur filters are client-side (filter within the current page of 10 rows). If the user filters for "Belum Lengkap" on page 1, rows that match on page 2+ are not shown. For full server-side filtering, the backend `DewanMasyayikhService.getDmList()` would need new query parameters.

---

## 9. E2E Test Coverage

### Test File: `e2e/tests/admin/lembaga-dewan.spec.ts`

| Section | Tests | Coverage |
|---------|-------|----------|
| A — Lembaga List | A-01 to A-17 | Table, search, filters, pagination, sort, row click |
| B — DM List | B-01 to B-17 | Columns, badges, SK+Struktur filters, search, pagination |
| C — DM Detail | C-01 to C-08 | 4 sections, edge cases, loading state, badges |
| D — Modal | D-01 to D-08 | EMIS source badge, sections, stats, sync API, diff table |
| E — Role Access | E-01 to E-03 | DM role hidden, admin visible, non-admin blocked |
| F — Cross-Module | F-01 to F-03 | Navigation, no console errors, API contract shape |

### Helpers: `e2e/helpers/table.helpers.ts`

| Helper | Purpose |
|--------|---------|
| `waitForLembagaApi` | Supports `/lembaga`, `/lembaga/dm`, `/dewan-masyayikh` |
| `waitForDmDetailApi` | Matches `/dewan-masyayikh/:id` GET |
| `waitForEmisApi` | Matches `/user/detaillembaga` POST |
| `waitForSyncEmisApi` | Matches `/sync-emis/:id` POST |

---

## 10. Risk Assessment

| Area | Risk | Mitigation |
|------|------|-----------|
| EMIS sync writes to `lembagas` | **MEDIUM** — could overwrite manually-corrected data | Only updates non-null EMIS fields; logs every change with old→new values |
| Status auto-calculation | **LOW** — deterministic from certificate + structure count | Idempotent; same input always produces same output |
| `@Async` failure | **LOW** — runs after API response returned | `CallerRunsPolicy` prevents silent drops; failures are logged |
| Client-side filters | **LOW** — only filters current page, not full dataset | Acceptable UX tradeoff; document as known limitation |
| Legacy endpoint coexistence | **NONE** — old endpoint untouched, new endpoint additive | No breaking changes to existing consumers |
