# Shimmy Vision Binary Audit Report

**Date**: January 8, 2026  
**Prepared By**: AI Assistant  
**Purpose**: Authoritative audit of vision-enabled binary status for Product Hunt launch

## Executive Summary

| Platform | Binary Exists | Vision Feature | Test Status | Ready? |
|----------|--------------|----------------|-------------|--------|
| Windows x86_64 | ✅ v1.8.2 | ❌ No | 🔄 Not tested | ❌ |
| Linux x86_64 | ✅ v1.8.2 | ❌ No | ✅ Build passes | ❌ |
| Linux ARM64 | ✅ v1.8.2 | ❌ No | ⏭️ Skipped | ❌ |
| macOS ARM64 | ✅ v1.8.2 | ❌ No | ⏭️ Skipped | ❌ |
| macOS Intel | ✅ v1.8.2 | ❌ No | ⏭️ Skipped | ❌ |

**Current State**: Binaries exist but **DO NOT** include vision feature.

---

## 1. Current Release Status (v1.8.2)

### 1.1 Published Assets
```
shimmy                      # Linux x86_64 
shimmy-linux-aarch64        # Linux ARM64
shimmy-linux-x86_64         # Linux x86_64 (duplicate)
shimmy-macos-arm64          # macOS Apple Silicon
shimmy-macos-intel          # macOS Intel
shimmy-windows-x86_64.exe   # Windows 64-bit
shimmy.exe                  # Windows 64-bit (duplicate)
```

### 1.2 Feature Analysis
Current v1.8.2 release was built with:
- `--features huggingface` (download models from HF)
- `--features llama` (llama.cpp backend)
- **NOT** `--features vision` (vision processing)

The vision feature is **NOT included** in any released binary.

---

## 2. Vision Feature Dependencies

### 2.1 Cargo.toml Configuration
```toml
vision = [
  "dep:shimmy-vision",      # Private vision crate
  "dep:image",              # Image processing
  "dep:base64",             # Base64 encoding
  "dep:chromiumoxide",      # Web page rendering
  "dep:ed25519-dalek",      # License verification
  "dep:hex",                # Hex encoding
  "dep:sha2"                # SHA-256 hashing
]
```

### 2.2 Private Repository Dependency
```toml
shimmy-vision = { 
  git = "https://github.com/Michael-A-Kuykendall/shimmy-vision-private.git", 
  optional = true 
}
```

This is a **PRIVATE repository** which creates CI/CD challenges.

---

## 3. CI/CD Testing Infrastructure

### 3.1 Workflow: Vision Cross-Platform Testing
**File**: `.github/workflows/vision-cross-platform-test.yml`  
**Trigger**: `workflow_dispatch` (manual)  
**Workflow ID**: `221605732`

### 3.2 Docker Test Containers
| Container | Purpose | Vision Support |
|-----------|---------|----------------|
| `Dockerfile.vision-test-linux-cuda` | Linux x86_64 + CUDA | ❌ Stripped |
| `Dockerfile.vision-test-linux-arm64` | Linux ARM64 | ❌ Stripped |
| `Dockerfile.vision-test-windows` | Windows via Wine | ❌ Stripped |
| `Dockerfile.vision-test-macos-cross` | macOS cross-compile | ❌ Stripped |

**Critical Issue**: All Dockerfiles contain:
```dockerfile
# Remove private vision dependency for CI builds
RUN sed -i '/shimmy-vision.*git.*shimmy-vision-private/d' Cargo.toml
RUN sed -i 's/vision = \[.*\]/vision = []/' Cargo.toml
```

This **strips the vision feature** because CI cannot access the private repo.

### 3.3 Recent Workflow Runs
All 5 recent runs FAILED:
- **Run 20822158417**: Linux CUDA ✅, ARM64 ⏭️, Windows ⏭️, Validation ❌
- **Run 20821997223**: Same pattern
- **Run 20821796853**: Same pattern
- **Run 20821640697**: Same pattern
- **Run 20821517382**: Same pattern

**Root Cause**: Workflow job conditions fail when no inputs provided via `workflow_dispatch`.

---

## 4. Prebuilt Library Status

### 4.1 Vision Libraries (`libs/vision/`)
```
libs/vision/
└── windows-x86_64/
    ├── shimmy_vision.def      (129 bytes)
    ├── shimmy_vision.dll      (3.4 MB)
    ├── shimmy_vision.dll.lib  (2.6 KB)
    └── shimmy_vision.lib      (54.5 MB)
```

**Only Windows** has prebuilt vision libraries.

**Missing**:
- `libs/vision/linux-x86_64/`
- `libs/vision/linux-arm64/`
- `libs/vision/macos-arm64/`
- `libs/vision/macos-intel/`

### 4.2 LLAMA Libraries (`libs/`)
```
libs/
├── linux-arm64/      (empty or missing libllama.a)
├── linux-x86_64/     (empty or missing libllama.a)
├── macos-arm64/      (empty or missing libllama.a)
├── macos-intel/      (empty or missing libllama.a)
├── windows-x86_64/   (empty or missing llama.lib)
└── vision/           (only windows-x86_64 populated)
```

---

## 5. Required Actions for Vision-Enabled Binaries

### 5.1 Option A: Private Repo Access in CI (Recommended)
1. Create GitHub Personal Access Token with `repo` scope
2. Add as repository secret: `SHIMMY_VISION_PRIVATE_TOKEN`
3. Update workflows to use token for private repo access
4. Rebuild with `--features vision`

### 5.2 Option B: Prebuilt Vision Libraries
1. Build `shimmy-vision` locally for each platform
2. Export as shared/static libraries
3. Store in `libs/vision/<platform>/`
4. Update `build.rs` to link prebuilt vision libs
5. CI builds without needing private repo access

### 5.3 Option C: Hybrid (Current Partial State)
- Windows: Use prebuilt `shimmy_vision.dll`
- Others: Build from private repo access

---

## 6. Workflow Fixes Required

### 6.1 Job Condition Bug
Current workflow has broken job conditions:
```yaml
if: contains(github.event.inputs.test_platforms, 'linux-x86_64') || github.event_name != 'workflow_dispatch'
```

When triggered via `workflow_dispatch` with default inputs, `github.event.inputs.test_platforms` is `null`, causing `contains()` to return `false` and jobs to skip.

**Fix**: Use proper default handling:
```yaml
if: >-
  github.event_name != 'workflow_dispatch' || 
  github.event.inputs.test_platforms == '' || 
  contains(github.event.inputs.test_platforms || 'linux-x86_64,linux-arm64,windows-x86_64', 'linux-x86_64')
```

### 6.2 Validation Job Bug
The validation job expects results from jobs that may have been skipped:
```yaml
expected_files=(
  "test-results/vision-test-results-linux-cuda/..."
  "test-results/vision-test-results-linux-arm64/..."  # May not exist!
  "test-results/vision-test-results-windows/..."      # May not exist!
)
```

**Fix**: Dynamically check which platforms were tested.

---

## 7. Local Build Verification

### 7.1 Windows Build (with vision)
```bash
cd c:\Users\micha\repos\shimmy-workspace
cargo build --features llama,vision --release
```
**Status**: ✅ Works (uses local shimmy-vision-private checkout)

### 7.2 Test vision commands
```bash
./target/release/shimmy.exe --help | grep -i vision
```

---

## 8. Next Steps

1. **Immediate**: Fix workflow job conditions
2. **Short-term**: Add private repo token to CI secrets
3. **Medium-term**: Build prebuilt libs for all platforms
4. **Launch**: Re-run cross-platform tests, verify all pass
5. **Release**: Tag new version with vision feature included

---

## Appendix A: Workflow Run Command

```bash
# Trigger with all platforms explicitly
gh workflow run "Vision Cross-Platform Testing" \
  --repo Michael-A-Kuykendall/shimmy \
  -f test_platforms="linux-x86_64,linux-arm64,windows-x86_64" \
  -f skip_macos=true

# Monitor progress
gh run list --workflow="Vision Cross-Platform Testing" --repo Michael-A-Kuykendall/shimmy --limit 3

# Watch specific run
gh run watch <run-id> --repo Michael-A-Kuykendall/shimmy
```

## Appendix B: Local Build Commands

```bash
# CPU-only build with vision
cargo build --features llama,vision --release

# GPU (CUDA) build with vision  
CARGO_TARGET_DIR=target-gpu cargo build --features llama,vision,llama-cuda --release

# Verify vision is included
./target/release/shimmy --version
./target/release/shimmy vision --help  # Should show vision subcommand
```
