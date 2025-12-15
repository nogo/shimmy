# Shimmy Vision — Production Readiness Checklist

> Last audit: 2025-12-15 by Copilot  
> Target: 95%+ production ready before private crate split

---

## ✅ COMPLETED — Blocking items resolved

### 1. Test Files Testing Removed Dev Mode Bypass
**Status:** ✅ FIXED  
**What was done:**
- Removed `test_dev_mode_bypasses_all_license_checks()` from `vision_license_flow_tests.rs`
- Removed `test_dev_mode_bypass()` from `vision_license_simple_tests.rs`
- Removed `test_check_vision_access_dev_mode_bypass()` from `vision_license_tests.rs`
- Updated `vision_api_integration.rs` to use pre-seeded license cache instead of dev mode bypass
- Added helper `create_test_router_with_license()` for tests needing valid license context

---

### 2. VS Code Tasks Updated
**Status:** ✅ FIXED  
**What was done:**
- Removed `SHIMMY_VISION_DEV_MODE=1` from all task commands in `.vscode/tasks.json`
- Tasks now use standard licensing (require valid license or env var)

---

### 3. Docs Updated
**Status:** ✅ FIXED  
**What was done:**
- Removed `SHIMMY_VISION_DEV_MODE=1` from `docs/vision-timings.md` example commands

---

### 4. Obsolete Analysis File
**Status:** ✅ DELETED  
**What was done:**
- Deleted `VISION_LICENSE_TEST_COVERAGE_ANALYSIS.md`

---

### 5. Private Repository Created
**Status:** ✅ DONE  
**What was done:**
- Created `https://github.com/Michael-A-Kuykendall/shimmy-vision-private` (private)
- Added proprietary LICENSE
- Added closed CONTRIBUTING.md (no external contributions)
- Added README.md with licensing info
- Scaffold Cargo.toml with dependencies
- Placeholder `src/lib.rs`, `src/vision.rs`, `src/license.rs`

---

### 6. Contribution Policy Updated
**Status:** ✅ DONE  
**What was done:**
- Updated shimmy `CONTRIBUTING.md` to "open source, not open contribution" model
- Matches crabcamera's policy (PRs not accepted by default, email-first)

---

## 🔴 CRITICAL — Private Crate Migration Steps

### Step 1: Copy Vision Code to Private Repo
**Status:** NOT STARTED  
**Files to copy:**
- `src/vision.rs` → `shimmy-vision-private/src/vision.rs` (~1,399 lines)
- `src/vision_license.rs` → `shimmy-vision-private/src/license.rs` (~674 lines)

**Commands:**
```bash
# From shimmy-workspace
cp src/vision.rs ../shimmy-vision-private/src/vision.rs
cp src/vision_license.rs ../shimmy-vision-private/src/license.rs
```

---

### Step 2: Update Private Crate Exports
**Status:** NOT STARTED  
**Edit `shimmy-vision-private/src/lib.rs`:**
```rust
mod license;
mod vision;

pub use license::*;
pub use vision::*;
```

**Update `Cargo.toml` dependencies** to match what vision.rs needs.

---

### Step 3: Create Adapter Trait in Public Shimmy
**Status:** NOT STARTED  
**Create `src/vision_adapter.rs`:**
- Define `VisionProvider` trait with `process_vision_request()` signature
- Implement trait for `shimmy-vision` crate when feature enabled
- Implement stub/error for when feature disabled

---

### Step 4: Update Public Cargo.toml
**Status:** NOT STARTED  
**Add to `Cargo.toml`:**
```toml
[dependencies.shimmy-vision]
git = "https://github.com/Michael-A-Kuykendall/shimmy-vision-private.git"
optional = true

[features]
vision = ["shimmy-vision"]
```

---

### Step 5: Test Private Crate Integration
**Status:** NOT STARTED  
**Verify:**
```bash
# Should fail (no access to private repo for random users)
cargo build --features vision

# Should succeed (you have access)
cargo build --features vision
```

---

### Step 6: Scrub Git History
**Status:** NOT STARTED  
**CRITICAL: Do this AFTER migration is verified working**

**Why:** Public shimmy repo contains full history of `src/vision.rs` and `src/vision_license.rs`. Anyone can `git log` or checkout old commits to see the proprietary code.

**Commands (using git-filter-repo):**
```bash
# Install git-filter-repo if not present
pip install git-filter-repo

# Backup first!
cd /c/Users/micha/repos
cp -r shimmy-workspace shimmy-workspace-backup

# Remove vision files from ALL history
cd shimmy-workspace
git filter-repo --path src/vision.rs --path src/vision_license.rs --invert-paths

# Force push (DESTRUCTIVE - breaks anyone's existing clones)
git push origin --force --all
git push origin --force --tags
```

**Alternative (BFG Repo Cleaner):**
```bash
# Download bfg.jar from https://rtyley.github.io/bfg-repo-cleaner/
java -jar bfg.jar --delete-files vision.rs --delete-files vision_license.rs
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push origin --force --all
```

**Post-scrub verification:**
```bash
# Should return nothing
git log --all --full-history -- src/vision.rs
git log --all --full-history -- src/vision_license.rs
```

---

### Step 7: Set Up CI Deploy Key
**Status:** NOT STARTED  
**For GitHub Actions to access private repo:**

1. Generate deploy key:
   ```bash
   ssh-keygen -t ed25519 -C "shimmy-ci-deploy-key" -f shimmy_deploy_key -N ""
   ```

2. Add public key to `shimmy-vision-private` repo:
   - Settings → Deploy keys → Add deploy key
   - Paste contents of `shimmy_deploy_key.pub`
   - Enable "Allow write access" if needed

3. Add private key to `shimmy` repo secrets:
   - Settings → Secrets → Actions → New repository secret
   - Name: `VISION_DEPLOY_KEY`
   - Value: contents of `shimmy_deploy_key`

4. Update CI workflow to use deploy key for `cargo build --features vision`

---

## 🟡 HIGH PRIORITY — Other Items

### License Verification Before Model Download
**Status:** UNVERIFIED — punch list item  
**Requirement:** License check must happen BEFORE any HuggingFace model download begins.

**Action:** Add integration test that mocks HF download and confirms license error fires first.

---

### End-to-End Functional Test Script
**Status:** Missing  
**From punch list:** "Add an end-to-end functional test script that starts `serve-vision-gpu` and runs 1 image + 1 URL request"

**Action:** Create `scripts/vision-e2e-test.sh` that:
1. Starts vision server via task
2. Waits for health check
3. Sends test image request
4. Sends test URL request (to allowed domain)
5. Validates response structure
6. Exits with clear pass/fail

---

## 🟢 RECOMMENDED — Nice to have before release

### Resumable Model Downloads
**Status:** Not implemented  
**Impact:** Better UX for interrupted downloads (~5.7GB total)

**Action:** Implement HTTP range requests in `ensure_download_and_verify()`.

---

### HTTP Rate Limiting for Vision API
**Status:** Not implemented  
**Impact:** Prevents abuse of `/api/vision` endpoint

**Action:** Add rate limiting middleware (especially for `--url` mode).

---

### Structured Logging Fields
**Status:** Partial  
**From punch list:** "Add structured fields for: mode, image dimensions, duration, error category"

**Action:** Audit vision request logging path for consistent structured output.

---

### Troubleshooting Documentation
**Status:** Missing  
**From punch list:** "Add troubleshooting section for: missing CUDA, missing Chromium, model checksum mismatch, and license validation failures"

**Action:** Add to `docs/SHIMMY_VISION_SPEC.md` or create `docs/VISION_TROUBLESHOOTING.md`.

---

## ✅ VERIFIED — Already done

### Production Code Clean
- [x] No `SHIMMY_VISION_DEV_MODE` bypass in `src/vision.rs`
- [x] No `SHIMMY_VISION_DEV_MODE` bypass in `src/vision_license.rs`
- [x] `check_vision_access()` always enforces license
- [x] `api.rs` uses dev mode only for error verbosity (not bypass)

### Security Hardening
- [x] SSRF protections (localhost/private IP blocking)
- [x] URL fetch size limit (25MB)
- [x] URL fetch timeout (30s)
- [x] Web mode page load timeout (60s)
- [x] Domain allowlist enforcement

### Model Bootstrap
- [x] HuggingFace download with SHA256 verification
- [x] In-process download lock (prevents concurrent downloads)
- [x] Hard-locked to MiniCPM-V model

### Licensing
- [x] Keygen integration with Ed25519 signature verification
- [x] Hard-coded account ID (prevents key-swapping)
- [x] License caching with 24h grace period
- [x] Usage metering with monthly reset

### Clippy
- [x] `cargo clippy --features llama,vision -- -D warnings` passes

### Repository Setup
- [x] Private repo created: `shimmy-vision-private`
- [x] Proprietary LICENSE in private repo
- [x] Closed CONTRIBUTING.md in private repo
- [x] Public shimmy CONTRIBUTING.md updated to "open source, not open contribution"

---

## Files Summary

| Category | Files | Status |
|----------|-------|--------|
| Production code | `src/vision.rs`, `src/vision_license.rs`, `src/api.rs` | ✅ Clean |
| Tests | `tests/vision_*.rs` (4 files) | ✅ Fixed |
| Tasks | `.vscode/tasks.json` | ✅ Fixed |
| Docs | `docs/vision-timings.md` | ✅ Fixed |
| Analysis | `VISION_LICENSE_TEST_COVERAGE_ANALYSIS.md` | ✅ Deleted |
| Private repo | `shimmy-vision-private` | ✅ Created (scaffold only) |

---

## Quick Reference: Current State

**Public repo (shimmy-workspace):**
- Branch: `feature/shimmy-vision-phase1`
- Vision code: Still in `src/vision.rs` and `src/vision_license.rs`
- Status: Dev mode bypass removed, tests fixed, ready for extraction

**Private repo (shimmy-vision-private):**
- Location: `../shimmy-vision-private/` (sibling directory)
- Remote: `https://github.com/Michael-A-Kuykendall/shimmy-vision-private.git`
- Status: Scaffold only, waiting for code copy

**Next action:** Copy vision code to private repo (Step 1 above)

---

*Generated by production audit. Updated 2025-12-15.*
